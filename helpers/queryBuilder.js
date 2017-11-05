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
			selections = selections.trim();
			if (selections.length === 0) {
				throw Error('select string is empty');
			}
		} else if (Object.prototype.toString.call(selections) === Object.prototype.toString.call([])) {
			if (selections.length === 0) {
				throw new Error('select array is empty');
			}
		} else {
			throw new Error('select must be a string or an array');
		}

		if (typeof selections === 'string') {
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
			table = table.trim();
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
		let childAlias;
		let parameters = [];
		let sql;

		sql = 'SELECT ' + (this.fields.length ? tableAlias + '.' + this.fields.join(', ' + tableAlias + '.') : '*') + ' FROM ' +
			(this.table || 'root') + ' ' + tableAlias;

		this.joins.forEach(function (table) {
			childAlias = table[0].toLowerCase();
			sql += ' JOIN ' + childAlias + ' IN ' + tableAlias + '.' + table;
		});
		this.filters.forEach(function (filter, index) {
			const keys = Object.keys(filter);

			if (!index) {
				sql += ' WHERE ';
			} else {
				sql += ' AND ';
			}

			keys.forEach(function (key, index) {
				const parameterName = '@' + key.split('.').pop();

				if (index) {
					sql += ' AND ';
				}
				sql += (childAlias || tableAlias) + '.' + key + ' = ' + parameterName;
				parameters.push({
					name: parameterName,
					value: filter[key]
				});
			});
		}, this);

		if (parameters.length) {
			return {
				parameters: parameters,
				query: sql
			};
		} else {
			return {
				query: sql
			};
		}
	}
}

module.exports = QueryBuilder;