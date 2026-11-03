/* Run by unpack.spec.ts under `node --permission`, as the engine runs the
 * plugin: unpacks the zip and asks for libaio, and tells what came of it */
import { findLibaio } from '../../src/utils/libaio.js';
import { unpackClient } from '../../src/utils/unpack.js';

const [zip, target] = process.argv.slice(2);
try {
  unpackClient(zip, target);
  console.log(JSON.stringify({ unpacked: true, libaio: findLibaio() }));
} catch (err: any) {
  console.log(JSON.stringify({ error: `${err.code || ''} ${err.message}` }));
}
