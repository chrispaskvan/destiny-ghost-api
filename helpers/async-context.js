import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();

export default context;
