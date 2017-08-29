'use strict';
function QueryBuilder() {
    this.filters = [];
    this.fields = [];
    this.joins = [];
    this.table = '';
}

QueryBuilder.prototype.select = function (selections) {
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
};

QueryBuilder.prototype.from = function (table) {
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
};

QueryBuilder.prototype.join = function (key) {
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
};

QueryBuilder.prototype.where = function (key, value) {
    var filter = {};

    filter[key] = value;
    this.filters.push(filter);

    return this;
};

QueryBuilder.prototype.getQuery = function () {
    var childAlias;
    var parameters = [];
    var sql;
    var tableAlias = this.table ? this.table[0].toLowerCase() : 'r';

    sql = 'SELECT ' + (this.fields.length ? tableAlias + '.' + this.fields.join(', ' + tableAlias + '.') : '*') + ' FROM ' +
        (this.table || 'root') + ' ' + tableAlias;

    this.joins.forEach(function (table) {
        childAlias = table[0].toLowerCase();
        sql += ' JOIN ' + childAlias + ' IN ' + tableAlias + '.' + table;
    });
    this.filters.forEach(function (filter, index) {
        var keys = Object.keys(filter);

        if (!index) {
            sql += ' WHERE ';
        } else {
            sql += ' AND ';
        }

        keys.forEach(function (key, index) {
            var parameterName = '@' + key.split('.').pop();

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
};

exports = module.exports = QueryBuilder;