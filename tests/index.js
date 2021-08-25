const {expect} = require('chai');
const express = require('express');
const request = require('supertest');
const extendExpress = require('../index');

describe('express', function () {
	let Router;

	beforeEach(function () {
		Router = extendExpress(express, {
			parseEndpoints: false,
			defaultMethod: 'POST',
		}).Router;
	});

	it('app', async function () {
		const app = express();

		app.use(express.json());

		app.baseUrl('/users');
		app.schema(`User = {id: number, name: string}`);
		app.url('/:id')
			.params(`User.props('id')`)
			.then(() => ({name: 'test'}))
			.response(`{name: string}`);

		const list = app.endpoints();

		expect(list).to.be.an('array');
		expect(list.length).to.eql(3);

		await request(app)
			.post('/users/10')
			.send({name: 'max'})
			.expect(function (res) {
				expect(res.statusCode).to.eql(200);
				expect(res.body).to.eql({name: 'test'});
			})
		;
	});

	it('router', async function () {
		const app = express();
		const router = Router();

		app.use(express.json());
		app.use(router);
		app.use(function (err, req, res, next) {
			res.status(err.statusCode || 500);

			try {
				res.json(err.statusCode && err.body || err);
			}
			catch (error) {
				res.json(error);
			}
		});

		var count = 0;

		router
			.baseUrl('/test')
			.callback(function (req, res, next) {
				count++;
				next();
			})
			.url('/baseUrl/test')
			.body(`{test: boolean}`)
			.then((req) => ({result: req.body.test}))
			.response(`{result: true}`)
		;

		router.schema(`Test = {id: id, name: string, age: number}`);

		router
			.url(`/:id`)
			.params(`Test.props('id')`)
			.query(`{search: string}`)
			.body(`Test.omit('id')`)
			.callback(function (req, res, next) {
				req.test = 1;
				res.test = 2;
				next();
			})
			.callback(function (req, res, next) {
				req.test += 10;
				res.test += 10;
				next();
			})
			.then(function (req) {
				expect(req.test).to.eql(11);

				return Promise.resolve(req.body);
			})
			.then(function (body) {
				if (body.name === 'jack') {
					return {error: body.name};
				}

				if (body.name === 'error') {
					throw {message: 'test'};
				}

				if (body.name === 'wrong_error') {
					throw {body: {}};
				}

				if (body.name === 'code_error') {
					let {age: code} = body;
					let err = code <= 400 ?
						{success: false}
						:
						code === 501 ?
							{test: true}
							:
							{wrong: 1}
					;

					throw {statusCode: code, body: err};
				}

				if (body.name === 'catch') {
					throw body;
				}

				return {name: body.name.toUpperCase()};
			})
			.catch(function (err) {
				if (err && err.name === 'catch') {
					return {name: 'Test'};
				}

				throw err;
			})
			.response(`{name: string}`)
			.response(`300 - 400 {success: false}`)
			.response(500, () => ({message: string}))
			.response('50X', `{test: boolean}`)
			.call(() => test.post())
		;

		var endpoints = Router.endpoints(true);

		expect(endpoints).length(3);
		expect(endpoints[2]).property('url').to.eql({
			method: 'POST',
			path: '/:id',
		});

		await request(app)
			.post('/test/1?search=test')
			.send({name: 'max', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(200);
				expect(res.body).to.eql({name: 'MAX'});
			})
		;

		await request(app)
			.post('/test/1')
			.send({name: 'max', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body)
					.include({
						'name': 'RequestValidationError',
						'property': 'query',
					});
			});

		await request(app)
			.post('/test/asd?search=asd')
			.send({name: 'max', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body)
					.include({
						'name': 'RequestValidationError',
						'property': 'params',
					});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'max'})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body)
					.include({
						'name': 'RequestValidationError',
						'property': 'body',
					});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'jack', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body)
					.include({
						'name': 'ResponseValidationError',
					});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'error', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body).to.eql({message: 'test'});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'wrong_error', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body).include({
					'name': 'ResponseValidationError',
				});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'code_error', age: 350})
			.expect(function (res) {
				expect(res.statusCode).to.eql(350);
				expect(res.body).to.eql({success: false});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'code_error', age: 501})
			.expect(function (res) {
				expect(res.statusCode).to.eql(501);
				expect(res.body).to.eql({test: true});
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'code_error', age: 502})
			.expect(function (res) {
				expect(res.statusCode).to.eql(502);
				expect(res.body).include({
					'name': 'ResponseValidationError',
				});
				expect(res.body.errors[0].message).to.eql(`must have required property 'test'`);
			});

		await request(app)
			.post('/test/1?search=asd')
			.send({name: 'catch', age: 20})
			.expect(function (res) {
				expect(res.statusCode).to.eql(200);
				expect(res.body).to.eql({name: 'Test'});
			});

		expect(count).to.eql(11);

		await request(app)
			.post('/test/baseUrl/test')
			.send({test: true})
			.expect(function (res) {
				expect(res.statusCode).to.eql(200);
				expect(res.body).to.eql({result: true});
			});

		await request(app)
			.post('/test/baseUrl/test')
			.send({test: false})
			.expect(function (res) {
				expect(res.statusCode).to.eql(500);
				expect(res.body).include({
					'name': 'ResponseValidationError',
				});
			});
	});

	it('catch', async function () {
		const app = express();

		app.use(express.json());

		app.url('/catch')
			.then(req => {throw req.body})
			.catch(function (err) {
				if (err.test === 1) {
					return {success: 1};
				}

				throw err;
			})
			.catch(function (err, req, res) {
				if (err.test === 2) {
					res.status(502);
					return {success: 2};
				}

				throw err;
			})
			.catch(function (err, req, res) {
				res.status(503).json({success: 3});
			});

		await request(app)
			.post('/catch')
			.send({test: 1})
			.expect(function (res) {
				expect(res.statusCode).to.eql(200);
				expect(res.body).to.eql({success: 1});
			})
		;

		await request(app)
			.post('/catch')
			.send({test: 2})
			.expect(function (res) {
				expect(res.statusCode).to.eql(502);
				expect(res.body).to.eql({success: 2});
			})
		;

		await request(app)
			.post('/catch')
			.send({test: 3})
			.expect(function (res) {
				expect(res.statusCode).to.eql(503);
				expect(res.body).to.eql({success: 3});
			})
		;
	});

	it('cast response', async function () {
		const Ajv = require('ajv').default;

		Router = extendExpress(express, {
			defaultMethod: 'POST',
			requestAjv: new Ajv(),
			responseAjv: new Ajv({coerceTypes: true}),
		}).Router;

		const app = express();

		app.use(express.json());

		class Test {
			constructor() {
				this.error = true;
			}

			toJSON() {
				return {
					id: '2',
				};
			}
		}

		app.url('/test')
		.body(`{test: number}`)
		.then(({body: {test}}) => (
			test === 1 ?
				{id: '1'} :
			test === 2 ?
				new Test() :
			test === 3 ?
				{date: new Date(2000, 1, 1, 1, 1, 1)}
				:
				new Error()
		))
		.response(`{id: number} || {date: date-time-tz}`);

		app.use(function (err, req, res, next) {
			res.status(err.statusCode || 500);

			try {
				res.json(err.statusCode && err.body || err);
			}
			catch (error) {
				res.json(error);
			}
		});

		Router.endpoints();

		await request(app)
		.post('/test')
		.send({test: 1})
		.expect(function (res) {
			expect(res.statusCode).to.eql(200);
			expect(res.body).to.eql({id: 1});
		});

		await request(app)
		.post('/test')
		.send({test: '1'})
		.expect(function (res) {
			expect(res.statusCode).to.eql(500);
			expect(res.body).to.include({
				name: "RequestValidationError"
			});
		});

		await request(app)
		.post('/test')
		.send({test: 2})
		.expect(function (res) {
			expect(res.statusCode).to.eql(200);
			expect(res.body).to.eql({id: 2});
		});

		await request(app)
		.post('/test')
		.send({test: 3})
		.expect(function (res) {
			expect(res.statusCode).to.eql(200);
			expect(res.body).to.eql({date: '2000-01-31T23:01:01.000Z'});
		});
	});
});
