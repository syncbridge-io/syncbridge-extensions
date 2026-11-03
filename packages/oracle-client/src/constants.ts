export const version = '1.1.3';

/** What the plugin keeps beside the client, so `remove` and the status know what is there */
export const INSTALL_RECORD = 'install.json';

/** The directory under the plugin's data directory the workers may read:
 * the engine gives them nothing outside it */
export const SHARED_DIR = 'shared';

/** Where the client is unpacked, under `SHARED_DIR` */
export const CLIENT_DIR = 'instantclient';
