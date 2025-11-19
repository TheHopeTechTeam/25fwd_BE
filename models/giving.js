const pool = require("../db");

const givingModel = {
  add: async (
    name,
    amount,
    currency,
    date,
    phone_number,
    email,
    receipt,
    paymentType,
    upload,
    receiptName,
    nationalid,
    company,
    taxid,
    note,
    campus,
    tpTradeID,
    isSuccess,
    env
  ) => {
    try {
      await pool.query(
        `INSERT INTO confgive (name, amount, currency, date, phone_number, email, receipt, paymentType, upload, receiptName, nationalid, company, taxid, note, campus, tp_trade_id, is_success, env) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          name,
          amount,
          currency,
          date,
          phone_number,
          email,
          receipt,
          paymentType,
          upload,
          receiptName,
          nationalid,
          company,
          taxid,
          note,
          campus,
          tpTradeID,
          isSuccess,
          env,
        ]
      );
      console.log("Data inserted with success");
    } catch (err) {
      console.error("Error executing query in givingModel.add:", err);
      throw err;
    }
  },
  get: async (lastRowID) => {
    try {
      const res = await pool.query(
        "SELECT * FROM confgive WHERE id > $1 AND env = 'production' AND amount > 1 ORDER BY id",
        [lastRowID]
      );
      return res.rows;
    } catch (e) {
      console.log(e);
      throw e;
    }
  },
};

module.exports = givingModel;
