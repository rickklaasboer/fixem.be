import 'reflect-metadata';
import bootstrap from '@/bootstrap';
import {app} from '@/container';
import Config from '@/config/Config';

const server = bootstrap();

export default {
    port: app(Config).port,
    fetch: server.fetch,
};
