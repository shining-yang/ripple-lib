/* @flow */
'use strict';
const _ = require('lodash');
const utils = require('./utils');
const validate = utils.common.validate;
const toRippledAmount = utils.common.toRippledAmount;
const Transaction = utils.common.core.Transaction;
const ValidationError = utils.common.errors.ValidationError;

function isXRPToXRPPayment(payment) {
  const sourceCurrency = _.get(payment, 'source.maxAmount.currency');
  const destinationCurrency = _.get(payment, 'destination.amount.currency');
  return sourceCurrency === 'XRP' && destinationCurrency === 'XRP';
}

function isIOUWithoutCounterparty(amount) {
  return amount && amount.currency !== 'XRP'
    && amount.counterparty === undefined;
}

function applyAnyCounterpartyEncoding(payment) {
  // Convert blank counterparty to sender or receiver's address
  //   (Ripple convention for 'any counterparty')
  // https://ripple.com/build/transactions/
  //    #special-issuer-values-for-sendmax-and-amount
  // https://ripple.com/build/ripple-rest/#counterparties-in-payments
  _.forEach([payment.source, payment.destination], (adjustment) => {
    _.forEach(['amount', 'minAmount', 'maxAmount'], (key) => {
      if (isIOUWithoutCounterparty(adjustment[key])) {
        adjustment[key].counterparty = adjustment.address;
      }
    });
  });
}

function createMaximalAmount(amount) {
  const maxXRPValue = '100000000000';
  const maxIOUValue = '9999999999999999e80';
  const maxValue = amount.currency === 'XRP' ? maxXRPValue : maxIOUValue;
  return _.assign(amount, {value: maxValue});
}

function createPaymentTransaction(account, paymentArgument) {
  const payment = _.cloneDeep(paymentArgument);
  applyAnyCounterpartyEncoding(payment);
  validate.address(account);
  validate.payment(payment);

  if ((payment.source.maxAmount && payment.destination.minAmount) ||
      (payment.source.amount && payment.destination.amount)) {
    throw new ValidationError('payment must specify either (source.maxAmount '
      + 'and destination.amount) or (source.amount and destination.minAmount)');
  }

  // when using destination.minAmount, rippled still requires that we set
  // a destination amount in addition to DeliverMin. the destination amount
  // is interpreted as the maximum amount to send. we want to be sure to
  // send the whole source amount, so we set the destination amount to the
  // maximum possible amount. otherwise it's possible that the destination
  // cap could be hit before the source cap.
  const amount = payment.destination.minAmount && !isXRPToXRPPayment(payment) ?
    createMaximalAmount(payment.destination.minAmount) :
    (payment.destination.amount || payment.destination.minAmount);

  const transaction = new Transaction();
  transaction.payment({
    from: payment.source.address,
    to: payment.destination.address,
    amount: toRippledAmount(amount)
  });

  if (payment.invoiceID) {
    transaction.invoiceID(payment.invoiceID);
  }
  if (payment.source.tag) {
    transaction.sourceTag(payment.source.tag);
  }
  if (payment.destination.tag) {
    transaction.destinationTag(payment.destination.tag);
  }
  if (payment.memos) {
    _.forEach(payment.memos, memo =>
      transaction.addMemo(memo.type, memo.format, memo.data)
    );
  }
  if (payment.noDirectRipple) {
    transaction.setFlags(['NoRippleDirect']);
  }
  if (payment.limitQuality) {
    transaction.setFlags(['LimitQuality']);
  }
  if (!isXRPToXRPPayment(payment)) {
    // Don't set SendMax for XRP->XRP payment
    // temREDUNDANT_SEND_MAX removed in:
    // https://github.com/ripple/rippled/commit/
    //  c522ffa6db2648f1d8a987843e7feabf1a0b7de8/
    if (payment.allowPartialPayment || payment.destination.minAmount) {
      transaction.setFlags(['PartialPayment']);
    }

    transaction.setSendMax(toRippledAmount(
      payment.source.maxAmount || payment.source.amount));

    if (payment.destination.minAmount) {
      transaction.setDeliverMin(toRippledAmount(payment.destination.minAmount));
    }

    if (payment.paths) {
      transaction.paths(JSON.parse(payment.paths));
    }
  } else if (payment.allowPartialPayment) {
    throw new ValidationError('XRP to XRP payments cannot be partial payments');
  }

  return transaction;
}

function preparePaymentAsync(account, payment, instructions, callback) {
  const transaction = createPaymentTransaction(account, payment);
  utils.prepareTransaction(transaction, this.remote, instructions, callback);
}

function preparePayment(account: string, payment: Object, instructions = {}) {
  return utils.promisify(preparePaymentAsync.bind(this))(
    account, payment, instructions);
}

module.exports = preparePayment;
