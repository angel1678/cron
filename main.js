require('dotenv').config();

const cron = require('node-cron');
const log4js = require("log4js");

const { select } = require("./utils/database");
const { procesarDetalle } = require("./utils/puppeteer");

log4js.configure({
    appenders: { console: { type: "console" } },
    categories: { default: { appenders: ["console"], level: "info" } },
});

const procesosJudiciales = async () => {
    const logger = log4js.getLogger("cron");
    logger.info('Iniciado.');
    const data = await select('SELECT id, judicatura_id, anio_id, numero_id, user_id FROM procesos WHERE activo = ?', [1]);
    await procesarDetalle(data.map(({ id: proceso_id, ...item }) => ({ proceso_id, ...item })));
    logger.info('Finalizado.');
}

if (process.env.APP_DEBUG === 'true') {
    procesosJudiciales();
} else {
    cron.schedule('*/59 * * * *', procesosJudiciales);
}
