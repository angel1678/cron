const getUUID = require('uuid-by-string');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { insert, select, update } = require('./database');

dayjs.extend(customParseFormat);

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    }
});

const getTextContent = async (value, position) => {
    return await (await value)[position].evaluate(e => e.textContent.trim());
}

const setValue = async (page, selector, value) => {
    return await page.$eval(selector, (element, value) => element.value = value, value);
}

const dateFormat = (fecha) => {
    const value = fecha ? dayjs(fecha, 'DD/MM/YYYY HH:mm') : dayjs();
    return value.format('YYYY-MM-DD HH:mm:ss');
}

const procesarDetalle = async (procesos = []) => {
    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();
    await page.goto('http://consultas.funcionjudicial.gob.ec/informacionjudicial/public/informacion.jsf', {waitUntil: 'networkidle0', timeout: 0});

    for(const {proceso_id, judicatura_id, anio_id, numero_id, user_id} of procesos) {
        console.log('Proceso Iniciado', JSON.stringify({proceso_id, judicatura_id, anio_id, numero_id}));

        await setValue(page, "input[id='form1:idJuicioJudicatura']", judicatura_id);
        await setValue(page, "input[id='form1:idJuicioAnio']", anio_id);
        await setValue(page, "input[id='form1:idJuicioNumero']", numero_id);

        const btnSeach = await page.$("button[id='form1:butBuscarJuicios']");
        await btnSeach.evaluate(e => e.click());
        await page.waitForSelector("tbody[id='form1:dataTableJuicios2_data'] > tr[role='row']");

        let accionInfraccion = null;
        const juicios = await page.$$("tbody[id='form1:dataTableJuicios2_data'] > tr");
        for(const juicioTr of juicios) {
            const btnMovimientos = await juicioTr.$("button");
            await btnMovimientos.evaluate(e => e.click());
            await page.waitForSelector("div[id='formJuicioDialogo:juicioDialogo']", {visible: true});

            const movimientos = await page.$$("tbody[id='formJuicioDialogo:dataTableMovimiento_data'] > tr[class='ui-widget-content']");
            let movimiento_id = null, proceso = null;

            for(const movimientoTr of movimientos) {
                const btnDetalles = await movimientoTr.$("button");
                await btnDetalles.evaluate(e => e.click());

                let fecha = await getTextContent(movimientoTr.$$('td'), 1);
                fecha = dateFormat(fecha);

                await page.waitForSelector("div[id='juicioDetalleDialogo']", {visible: true});
                await page.waitForTimeout(2000);

                const movimientoForm = (await page.$$("div[id='formJuicioDetalle:juicioDetalleDetail'] > div"))[0];
                const movimientoInfo = await movimientoForm.$$("table > tbody > tr");

                proceso = await getTextContent(movimientoInfo[0].$$('td'), 1);
                const numeroIngreso = await getTextContent(movimientoInfo[0].$$('td'), 3);
                const dependenciaJurisdiccional = await getTextContent(movimientoInfo[1].$$('td'), 1);

                accionInfraccion = await getTextContent(movimientoInfo[1].$$('td'), 3);
                movimiento_id = getUUID(`${proceso}-${numeroIngreso}-${dependenciaJurisdiccional}`);
                const movimientoDB = await select(`SELECT * FROM procesos_movimiento WHERE proceso_id = ? AND id = ?`, [proceso_id, movimiento_id]);
                if (movimientoDB.length == 0) {
                    const actorOfendido = (await (await movimientoInfo[2].$$('td'))[1].$$eval("div > dl > dt", e => e.map(i => i.textContent))).join('\n');
                    const demandadoProcesado = (await (await movimientoInfo[2].$$('td'))[3].$$eval("div > dl > dt", e => e.map(i => i.textContent))).join('\n');
                    const createAt = dateFormat();

                    await insert(
                        'procesos_movimiento', 
                        {
                            id: movimiento_id, 
                            proceso_id,
                            fecha,
                            numero_ingreso: numeroIngreso,
                            dependencia_jurisdiccional: dependenciaJurisdiccional,
                            actor_ofendido: actorOfendido,
                            accion_infraccion: accionInfraccion,
                            demandado_procesado: demandadoProcesado,
                            created_at: createAt,
                            updated_at: createAt
                        }
                    );
                }

                let isExit = true;
                const btnNextPage = await page.$("div[id='formJuicioDetalle:dataTable_paginator_bottom'] > a[aria-label='Next Page']");
                do {
                    isExit = btnNextPage && await btnNextPage.evaluate(el => !el.classList.contains('ui-state-disabled'));

                    const detalles = await page.$$("tbody[id='formJuicioDetalle:dataTable_data'] > tr");
                    for(const item of detalles) {
                        // let [fecha, comentario] = await item.$$eval('td', element => element.map(i => i.textContent));

                        const [fechaTd, comentarioTd] = await item.$$('td');
                        const fecha = dateFormat(await fechaTd.evaluate(e => e.textContent.trim()));
                        const titulo = await comentarioTd.$eval('legend', e => e.textContent.trim());
                        const comentario = await comentarioTd.$eval('div', e => e.textContent.trim());

                        const detalle_id = getUUID(`${movimiento_id}-${fecha}-${titulo}-${comentario}`);
                        const createAt = dateFormat();

                        const data = await select(`SELECT * FROM procesos_detalle WHERE movimiento_id = ? AND id = ?`, [movimiento_id, detalle_id]);
                        if (data.length == 0) {
                            await insert(
                                'procesos_detalle', 
                                {id: detalle_id, movimiento_id, fecha, titulo, comentario, created_at: createAt, updated_at: createAt}
                            );
                        }
                    }

                    if (isExit) {
                        await btnNextPage.evaluate(e => e.click());
                        await page.waitForTimeout(2000);
                    }
                } while(isExit);
            }

            const [detalle] = await select(`SELECT * FROM procesos_detalle WHERE movimiento_id = ? ORDER BY fecha DESC limit 1`, [movimiento_id]);
            const [movimiento] = await select(`SELECT * FROM procesos_movimiento WHERE id = ?`, [movimiento_id]);
            const [user] = await select(`SELECT * FROM users WHERE id = ?`, [user_id]);
            if (detalle && !detalle.sended_at) {
                const fecha = dayjs(detalle.fecha).format('YYYY-MM-DD HH:mm:ss');
                const demandados = movimiento.demandado_procesado.replace('\n', ', ');
                const info = await transporter.sendMail({
                    from: `"Admin" <${process.env.MAIL_USER}>`,
                    to: user.email,
                    subject: `${proceso} - ${fecha} - ${detalle.titulo} - ${movimiento.dependencia_jurisdiccional} - ${movimiento.accion_infraccion}`,
                    html: `<div><div><b>Demandado Procesado:</b> ${demandados}</div><br><div>${detalle.comentario}</div></div>`,
                });

                if (info.messageId) {
                    console.log(`Se envio el mensaje ${info.messageId} al correo ${user.email}`);
                    await update('procesos_detalle', {sended_at: dateFormat()}, {id: detalle.id});
                }
            }
        }

        await update('procesos', {accion_infraccion: accionInfraccion, executed_at: dateFormat()}, {id: proceso_id});
        await page.reload();
        console.log('Proceso Finalizado\n');
    }
    await browser.close();
}

module.exports = {
    procesarDetalle
};