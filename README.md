# adv-express

ADV integration with Express

## Usage

```js
const express = require('express');
const app = require('adv-express')({express});

const users = express.Router({mergeParams: true});

app.use('/users', users);

app
    .schema(`Success = {success: true}`)
    .schema(`Error = {success: false, message: string}`)

users
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
    .then(req => Users.findById(req.params.id))
    .response(`User`);

users
    .url('POST /:id')
    .params(`User.props('id')`)
    .body(`User`)
    .callback(function (req, res) {
        Users
            .findById(req.params.id)
            .update(req.body)
            .then(() => res.json({success: true}))
            .catch(err => res.status(500).json({success: false, message: err.message}));
    })
    .response(`Success`)
    .response(`5xx Error`);
```

## Share schemas

Share schemas with [adv-sequelize](https://github.com/redexp/adv-sequelize)

```js
const defaultSchemas = require('adv-parser/schemas');
const schemas = {...defaultSchemas};
const createModel = require('adv-sequelize');
const define = code => createModel(code, {schemas});
const app = require('adv-express')({schemas});

const User = define(`User = {
    id: number, 
    name: string.minLength(3).maxLength(20),
}`);

app
    .url('/users/:id')
    .params(`User.props('id')`)
    .then(req => User.findByPk(req.params.id))
    .response(`User`);
```
