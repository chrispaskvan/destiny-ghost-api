'use strict';
function QueryBuilder() {
    this.filters = [];
    this.fields = [];
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
            throw Error('select array is empty');
        }
    } else {
        throw Error('select must be a string or an array');
    }

    if (typeof selections === 'string') {
        if (selections.indexOf(',') === -1) {
            selections = selections.split(',');
        } else {
            selections = [selections];
        }
    }

    selections.forEach(function (selection) {
        var field = selection.trim();

        if (field !== '') {
            this.fields.push(field);
        }
    }, this);

    return this;
};

QueryBuilder.prototype.from = function (table) {
    if (typeof table === 'string') {
        table = table.trim();
        if (table.length === 0) {
            throw Error('table string is empty');
        }
    } else {
        throw Error('table is not a string');
    }

    this.table = table;

    return this;
};

QueryBuilder.prototype.where = function (key, value) {
    var filter = {};

    filter[key] = value;
    this.filters.push(filter);

    return this;
};

QueryBuilder.prototype.getQuery = function () {
    var parameters = [];
    var sql;
    var tableAlias = this.table ? this.table[0] : 'r';

    sql = 'SELECT ' + (this.fields.length ? this.fields.join(', ') : '*') + ' FROM ' +
        (this.table || 'root') + ' ' + tableAlias;
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
            sql += tableAlias + '.' + key + ' = ' + parameterName;
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