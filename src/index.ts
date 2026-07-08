import 'reflect-metadata';
import bootstrap from '@/bootstrap';
import {app} from '@/container';
import Config from '@/config/Config';
import Logger from '@/services/Logger';

const server = bootstrap();
const config = app(Config);

app(Logger).info({port: config.port}, 'fixem.be listening');

export default {
    port: config.port,
    fetch: server.fetch,
};
