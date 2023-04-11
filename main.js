require('dotenv').config();

const cron = require('node-cron');
const { select } = require("./utils/database");
const { procesarDetalle } = require("./utils/puppeteer");

console.log('Iniciando aplicacion.');

// cron.schedule('59 * * * *', async () => {
//     const data = await select('SELECT id, judicatura_id, anio_id, numero_id, user_id FROM procesos WHERE activo = ?', [1]);
//     await procesarDetalle(data.map(({id: proceso_id, ...item}) => ({proceso_id, ...item})));
// });

(async () => {
    const data = await select('SELECT id, judicatura_id, anio_id, numero_id, user_id FROM procesos WHERE activo = ?', [1]);
    await procesarDetalle(data.map(({id: proceso_id, ...item}) => ({proceso_id, ...item})));
})()