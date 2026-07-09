import 'reflect-metadata';
import bootstrap from '@/bootstrap';
import {app} from '@/container';
import AppConfig from '@/config/AppConfig';
import Logger from '@/services/Logger';

const server = bootstrap();
const config = app(AppConfig);

app(Logger).info({port: config.port}, 'fixem.be listening');

export default {
    port: config.port,
    fetch: server.fetch,
};
