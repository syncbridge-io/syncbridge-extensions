import { expect } from 'expect';
import { SqbClientComponent } from '../src/components/sqb-client.component.js';

function createComponent(values: object) {
  const component: any = Object.create(SqbClientComponent.prototype);
  component.values = { pool: {}, ...values };
  component.components = {};
  /* Its state as the engine keeps it; never started here */
  component._context = { status: 'stopped' };
  component.queriesLog = { write: () => undefined };
  // A bare instance has no runtime state for the liveness timer to read
  component._resetLiveness = () => undefined;
  return component;
}

describe('SqbClientComponent', () => {
  it('should write the SQL it runs and what fails to its queries channel', async () => {
    const component = createComponent({
      dialect: 'postgres',
      host: '127.0.0.1',
    });
    const records: any[] = [];
    component.queriesLog = { write: (r: any) => records.push(r) };
    await component._init();
    try {
      component.client.emit('execute', {
        sql: 'select * from orders where id = :id',
        params: { id: 1 },
      });
      component.client.emit('error', new Error('refused'));
      expect(records.map(r => [r.event, r.level, r.message, r.fields])).toEqual(
        [
          [
            'execute',
            'info',
            'select * from orders where id = :id',
            { params: { id: 1 } },
          ],
          ['error', 'error', 'refused', undefined],
        ],
      );
    } finally {
      await component.client.close();
    }
  });

  it('should build a client for each dialect it offers', async () => {
    for (const dialect of [
      'postgres',
      'oracle',
      'mssql',
      'mysql',
      'mariadb',
      'sqlite',
    ]) {
      const component = createComponent({ dialect, database: ':memory:' });
      await component._createClient();
      try {
        expect(component.client.dialect).toEqual(dialect);
      } finally {
        await component.client.close(0);
      }
    }
  });

  it('should run queries on SQLite', async () => {
    const component = createComponent({
      dialect: 'sqlite',
      database: ':memory:',
    });
    await component._createClient();
    try {
      const result = await component
        .getClient()
        .execute('select 1 as one', { objectRows: true });
      expect(result.rows).toEqual([{ one: 1 }]);
    } finally {
      await component.client.close(0);
    }
  });

  it('should refuse a dialect it does not know', async () => {
    const component = createComponent({ dialect: 'db2' });
    await expect(component._createClient()).rejects.toThrow(
      'Unknown database dialect "db2"',
    );
  });
});
