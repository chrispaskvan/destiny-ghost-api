/**
 * Query Builder Class
 */
class QueryBuilder {
    constructor() {
        this.filters = [];
        this.fields = [];
        this.joins = [];
        this.table = '';
    }

    /**
     *
     * @param selections
     * @returns {QueryBuilder}
     */
    select(selections) {
        if (typeof selections === 'string') {
            // eslint-disable-next-line no-param-reassign
            selections = selections.trim();
            if (selections.length === 0) {
                throw Error('select string is empty');
            }
        } else if (Object.prototype.toString
            .call(selections) === Object.prototype.toString.call([])) {
            if (selections.length === 0) {
                throw new Error('select array is empty');
            }
        } else {
            throw new Error('select must be a string or an array');
        }

        if (typeof selections === 'string') {
            // eslint-disable-next-line no-param-reassign, no-unused-expressions
            selections.indexOf(',') === -1 ? selections = selections.split(',') : selections = [selections];
        }

        selections.forEach(selection => {
            const field = selection.trim();

            if (field !== '') {
                this.fields.push(field);
            }
        });

        return this;
    }

    /**
     *
     * @param table
     * @returns {QueryBuilder}
     */
    from(table) {
        if (typeof table === 'string') {
            table = table.trim(); // eslint-disable-line no-param-reassign
            if (table.length === 0) {
                throw new Error('table string is empty');
            }
        } else {
            throw new Error('table is not a string');
        }

        this.table = table;

        return this;
    }

    /**
     *
     * @param key
     * @returns {QueryBuilder}
     */
    join(key) {
        if (typeof key === 'string') {
            if (key) {
                this.joins.push(key.trim());
            } else {
                throw new Error('key string is empty');
            }
        } else {
            throw new Error('key is not a string');
        }

        return this;
    }

    /**
     *
     * @param key
     * @param value
     * @returns {QueryBuilder}
     */
    where(key, value) {
        const filter = {};

        // eslint-disable-next-line security/detect-object-injection
        filter[key] = value;
        this.filters.push(filter);

        return this;
    }

    /**
     *
     * @returns {*}
     */
    getQuery() {
        const tableAlias = this.table ? this.table[0].toLowerCase() : 'r';
        const fields = (this.fields.length ? `${tableAlias}.${this.fields.join(`, ${tableAlias}.`)}` : '*');
        let childAlias;
        const parameters = [];
        let sql;

        sql = `SELECT ${fields} FROM ${(this.table || 'root')} ${tableAlias}`;

        this.joins.forEach(table => {
            childAlias = table[0].toLowerCase();
            sql += ` JOIN ${childAlias} IN ${tableAlias}.${table}`;
        });
        this.filters.forEach((filter, filterIndex) => {
            const keys = Object.keys(filter);

            if (!filterIndex) {
                sql += ' WHERE ';
            } else {
                sql += ' AND ';
            }

            keys.forEach((key, keyIndex) => {
                const parameterName = `@${key.split('.').pop()}`;

                if (keyIndex) {
                    sql += ' AND ';
                }
                sql += `${childAlias || tableAlias}.${key} = ${parameterName}`;
                parameters.push({
                    name: parameterName,
                    // eslint-disable-next-line security/detect-object-injection
                    value: filter[key],
                });
            });
        }, this);

        if (parameters.length) {
            return {
                parameters,
                query: sql,
            };
        }

        return {
            query: sql,
        };
    }
}

export default QueryBuilder;
