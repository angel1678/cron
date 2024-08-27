const getUUID = require('uuid-by-string');
const puppeteer = require('puppeteer');
const log4js = require("log4js");

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

const { insert, select, update } = require('./database');

dayjs.extend(customParseFormat);
dayjs.extend(utc)
dayjs.extend(timezone)

const dateFormat = (fecha) => {
    const value = fecha ? dayjs(fecha, 'DD/MM/YYYY HH:mm') : dayjs().tz('America/Guayaquil');
    return value.format('YYYY-MM-DD HH:mm:ss');
}

const procesarDetalle = async (procesos = []) => {
    const logger = log4js.getLogger('Proceso');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    for (const { proceso_id, judicatura_id, anio_id, numero_id, user_id } of procesos) {
        try {
            await page.goto(process.env.PAGE_URL, { waitUntil: 'domcontentloaded' });
            logger.info(`Iniciado - ID: ${proceso_id}.`);

            const inputSearch = await page.$("input[formcontrolname='numeroCausa']");
            await inputSearch.type(`${judicatura_id}-${anio_id}-${numero_id}`);
            await inputSearch.press("Enter");
            await page.waitForNavigation({ waitUntil: 'networkidle0' });

            let accionInfraccion = null;
            const causas = await page.$$("section[class='causas'] > div[class='cuerpo'] > div");

            for (const causa of causas) {
                (await causa.$("div > a")).click();
                await page.waitForSelector("div[class='lista-movimientos-causa'] div[class='movimiento-individual ng-star-inserted']");

                let movimiento_id = null, proceso = null;
                const movimientosCount = await page.$$eval("div[class='lista-movimientos-causa'] > div[class='cuerpo'] > div", e => e.length);
                for (let i = 0; i < movimientosCount; i++) {
                    const movimientos = await page.$$("div[class='lista-movimientos-causa'] > div[class='cuerpo'] > div");
                    const movimiento = movimientos[i];
                    if (movimiento) {
                        const numeroIncidente = await movimiento.$eval("div[class='numero-incidente']", e => e.innerHTML.trim());
                        const fechaIngreso = await movimiento.$eval("div[class='fecha-ingreso']", e => e.innerHTML.trim());
                        (await movimiento.$("div > a")).evaluate(e => e.click());
                        await page.waitForSelector("section[class='panel-expansion'] > mat-accordion > mat-expansion-panel");

                        const movimientoInfo = (await page.$$("header[class='cabecera-informacion'] section[class='filtros-busqueda']"))[1];
                        const movimientoDato = await movimientoInfo.$$eval("div > span", e => e.map(item => item.innerHTML.trim()));

                        proceso = movimientoDato[0];
                        accionInfraccion = movimientoDato[4];
                        movimiento_id = getUUID(`${proceso}-${numeroIncidente}-${movimientoDato[5]}`);
                        const movimientoDB = await select(`SELECT * FROM procesos_movimiento WHERE proceso_id = ? AND id = ?`, [proceso_id, movimiento_id]);

                        if (movimientoDB.length == 0) {
                            const createAt = dateFormat();

                            await insert(
                                'procesos_movimiento',
                                {
                                    id: movimiento_id,
                                    proceso_id,
                                    fecha: dateFormat(fechaIngreso),
                                    numero_ingreso: numeroIncidente,
                                    dependencia_jurisdiccional: movimientoDato[5],
                                    actor_ofendido: movimientoDato[6],
                                    accion_infraccion: accionInfraccion,
                                    demandado_procesado: movimientoDato[7],
                                    created_at: createAt,
                                    updated_at: createAt
                                }
                            );
                        }

                        const detalleMovimiento = await page.$$("mat-accordion[id='actuaciones-judiciales'] > mat-expansion-panel");
                        for (const detalle of detalleMovimiento) {
                            const headerDato = await detalle.$$eval("mat-expansion-panel-header div > span", e => e.map(item => item.innerHTML.trim()));
                            const bodyDato = await detalle.$eval("article[class='actividad pagina']", e => e.textContent.trim());

                            const fecha = dateFormat(headerDato[0]);
                            const detalle_id = getUUID(`${movimiento_id}-${fecha}-${headerDato[1]}-${bodyDato}`);
                            const createAt = dateFormat();

                            const data = await select(`SELECT * FROM procesos_detalle WHERE movimiento_id = ? AND id = ?`, [movimiento_id, detalle_id]);
                            if (data.length == 0) {
                                await insert(
                                    'procesos_detalle',
                                    { id: detalle_id, movimiento_id, fecha, titulo: headerDato[1], comentario: bodyDato, created_at: createAt, updated_at: createAt }
                                );
                            }
                        }

                        page.goBack();
                        await page.waitForSelector("div[class='lista-movimientos-causa'] div[class='movimiento-individual ng-star-inserted']");
                    }
                }

                const [detalle] = await select(`SELECT * FROM procesos_detalle WHERE movimiento_id = ? ORDER BY fecha DESC limit 1`, [movimiento_id]);
                if (detalle && !detalle.sended_at) {
                    await update('procesos_detalle', { send_notification:true }, { id: detalle.id });
                }
            }

            await update('procesos', { accion_infraccion: accionInfraccion, executed_at: dateFormat() }, { id: proceso_id });
        } catch (e) {
            logger.error(`${e.message} - ID ${proceso_id}.`);
        } finally {
            logger.info(`Finalizado - ID: ${proceso_id}.`);
        }
    }
    await browser.close();
}

module.exports = {
    procesarDetalle
};