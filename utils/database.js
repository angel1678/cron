const mysql = require('mysql');

const conn = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

const select = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        conn.query({ sql, values }, (error, results, fields) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

const insert = (table, data) => {
    return new Promise((resolve, reject) => {
        conn.query(`INSERT INTO ${table} SET ?`, data, (error, results, fields) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

const getKeysFormat = (values) => {
    return Object.keys(values).map(key => `${key} = ?`).join(', ');
}

const getValuesFormat = (values) => {
    return Object.keys(values).map(key => values[key]);
}

const getFormatUpdate = (values) => {
    return [
        getKeysFormat(values),
        getValuesFormat(values)
    ];
}

const update = (table, values = {}, conditions = {}) => {
    return new Promise((resolve, reject) => {
        const [valuesKey, valuesValue] = getFormatUpdate(values);
        const [conditionsKey, conditionsValue] = getFormatUpdate(conditions);
        conn.query(`UPDATE ${table} SET ${valuesKey} WHERE ${conditionsKey}`, [...valuesValue, ...conditionsValue], (error, results, fields) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

module.exports = {
    select,
    insert,
    update,
    query: conn.query,
}