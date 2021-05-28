adv-express
-----------

[![Build Status](https://travis-ci.com/redexp/adv-express.svg?branch=master)](https://travis-ci.com/redexp/adv-express)

ADV integration with Express

## Usage

```js
const express = require('express');

require('adv-express')(express);

const users = express.Router();

app.use(express.json());
app.use(users);

users.baseUrl('/users');

users
    .schema(`Success = {success: true}`)
    .schema(`Error = {success: false, message: string}`)
    .schema(`User = {
        id: number, 
        name: string.minLength(3).maxLength(20),
    }`);

users
    .url('/')
    .query(`User.props('name')`)
    .then(req => Users.findByName(req.query.name))
    .response(`[User]`);

users
    .url('/:id')
    .params(`User.props('id')`)
    .callback(require('some-express-middleware'))
    .then(req => Users.findById(req.params.id))
    .catch((err, req, res) => {
    	res.status(500);
    	
    	return {error: true, message: err.message};
    })
    .response(`User`)
    .response(`5xx {error: true, message: string}`);

users
    .url('POST /:id')
    .params(`User.props('id')`)
    .body(`User.omit('id')`)
    .callback(function (req, res) {
        Users
            .findById(req.params.id)
            .then(user => user.update(req.body))
            .then(() => res.json({success: true}))
            .catch(err => res.status(500).json({success: false, message: err.message}));
    })
    .response(`Success`)
    .response(`5xx Error`);
```

## Arguments

1. `express` - express module
2. `options`
   * `schemas` - object where key is schema name and value is [ajv json schema](https://ajv.js.org/json-schema.html). Defaults to clone of `adv-parser/schemas`
   * `ajv` - [Ajv instance](https://ajv.js.org/api.html). Defaults to `new Ajv({coerceTypes: true})`.
   * `defaultMethod` - http method name. Default is `GET`.
   * `parseEndpoints` - should all schemas to be parsed on next process tick. Default is `true`.

## Share schemas

Share schemas with [adv-sequelize](https://github.com/redexp/adv-sequelize)

```js
const defaultSchemas = require('adv-parser/schemas');
const schemas = {...defaultSchemas};
const express = require('express');
require('adv-express')(express, {schemas});
const createModel = require('adv-sequelize');
const define = code => createModel(code, {schemas});

const User = define(`User = {
    id: id.primaryKey(), 
    name: string.minLength(3).maxLength(20),
}`);

app
    .url('/users/:id')
    .params(`User.props('id')`)
    .then(req => User.findByPk(req.params.id))
    .response(`User`);
```
