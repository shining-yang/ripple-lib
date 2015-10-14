/* @flow */
'use strict';
const _ = require('lodash');
const common = require('../common');

function convertLedgerHeader(header) {
  return {
    accepted: header.accepted,
    closed: header.closed,
    account_hash: header.stateHash,
    close_time: header.closeTime,
    close_time_resolution: header.closeTimeResolution,
    close_flags: header.closeFlags,
    hash: header.ledgerHash,
    ledger_hash: header.ledgerHash,
    ledger_index: header.ledgerVersion.toString(),
    seqNum: header.ledgerVersion.toString(),
    parent_hash: header.parentLedgerHash,
    parent_close_time: header.parentCloseTime,
    total_coins: header.totalDrops,
    totalCoins: header.totalDrops,
    transaction_hash: header.transactionHash
  };
}

function hashLedgerHeader(ledgerHeader) {
  const header = convertLedgerHeader(ledgerHeader);
  return common.core.Ledger.calculateLedgerHash(header);
}

function computeTransactionHash(ledger) {
  if (ledger.rawTransactions === undefined) {
    return ledger.transactionHash;
  }
  const transactions = JSON.parse(ledger.rawTransactions);
  const txs = _.map(transactions, tx => {
    const mergeTx = _.assign({}, _.omit(tx, 'tx'), tx.tx || {});
    const renameMeta = _.assign({}, _.omit(mergeTx, 'meta'),
      tx.meta ? {metaData: tx.meta} : {});
    return renameMeta;
  });
  const ledgerObject = common.core.Ledger.from_json({transactions: txs});
  const transactionHash = ledgerObject.calc_tx_hash();
  if (ledger.transactionHash !== undefined
      && ledger.transactionHash !== transactionHash) {
    throw new common.errors.ValidationError('transactionHash in header'
      + ' does not match computed hash of transactions');
  }
  return transactionHash;
}

function computeStateHash(ledger) {
  if (ledger.rawState === undefined) {
    return ledger.stateHash;
  }
  const state = JSON.parse(ledger.rawState);
  const ledgerObject = common.core.Ledger.from_json({accountState: state});
  const stateHash = ledgerObject.calc_account_hash();
  if (ledger.stateHash !== undefined && ledger.stateHash !== stateHash) {
    throw new common.errors.ValidationError('stateHash in header'
      + ' does not match computed hash of state');
  }
  return stateHash;
}

function computeLedgerHash(ledger: Object): string {
  const hashes = {
    transactionHash: computeTransactionHash(ledger),
    stateHash: computeStateHash(ledger)
  };
  return hashLedgerHeader(_.assign({}, ledger, hashes));
}

module.exports = computeLedgerHash;
