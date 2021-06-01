const annotations = require('api-doc-validator/lib/annotations');
const {getAstSchema, generateAjvSchema} = require('adv-parser');
const defaultSchemas = require('adv-parser/schemas');

module.exports = extendExpress;
module.exports.extendApplication = extendApplication;
module.exports.extendRouter = extendRouter;

/**
 * @typedef {{props: function (prop: string): AdvModel}} AdvModel
 * @typedef {string|function (name?: AdvModel): (AdvModel|Array<AdvModel>)} AdvSchema
 * @typedef {function (schema: AdvSchema): AdvRouter} AdvMethod
 * @typedef {function(): void|function(err: Error): void} AdvNext
 * @typedef {function(req: Request, res: Response)|function(req: Request, res: Response, next: AdvNext)|function(err: Error, req: Request, res: Response, next: AdvNext)} AdvCallback
 * @typedef {{callback: function (cb: AdvCallback): AdvRouter, then: function (result: any): AdvRouter, catch: function (error: Error): AdvRouter, params: AdvMethod, query: AdvMethod, body: AdvMethod, response: AdvMethod|function(code: string|number, schema: AdvSchema):AdvRouter, call: AdvMethod, schema: AdvMethod}} AdvRouter
 */

/**
 * @param express
 * @param {{schemas?: Object, ajv?: import('ajv'), parseEndpoints?: boolean, defaultMethod?: string, defaultCode?: string|number}} options
 * @returns {{Router: function(options?: import('express').RouterOptions): {baseUrl: function (path: string): AdvRouter, url: function (path: string): AdvRouter, schema: AdvMethod, endpoints: Array<Object>}}}
 */
function extendExpress(express, options = {}) {
	extendApplication(express.application);
	extendRouter(express.Router, options);

	return express;
}

function extendApplication(app) {
	['baseUrl', 'url', 'schema', 'endpoints'].forEach(function (method) {
		app[method] = function (...args) {
			this.lazyrouter();
			return this._router[method](...args);
		};
	});
}

function extendRouter(
	Router,
	{
		schemas = {...defaultSchemas},
		ajv,
		parseEndpoints = true,
		defaultMethod = 'GET',
		defaultCode = 200,
	}
) {
	var routes = [];
	var ready = false;

	if (!ajv) {
		ajv = getAjv();
	}

	Router.baseUrl = function (baseUrl) {
		if (arguments.length === 0) return this._baseUrl || '';

		if (this._baseUrl) {
			throw new Error('Router: baseUrl already set');
		}

		this._baseUrl = baseUrl;

		var router = new AdvExpressRouter({
			Router,
			router: this,
			ajv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.baseUrl(baseUrl);
	};

	Router.url = function url(path) {
		var router = new AdvExpressRouter({
			Router,
			router: this,
			ajv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.url(path);
	};

	Router.schema = function (code) {
		var router = new AdvExpressRouter({
			Router,
			router: this,
			ajv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.schema(code);
	};

	Router.endpoints = function (force) {
		if (ready && !force) return routes.map(route => route.endpoint);

		const getAst = value => {
			if (Array.isArray(value)) {
				return value.map(getAst);
			}

			if (value.schema) {
				value.schema = getAstSchema(value.schema, {schemas});
			}

			return value;
		};

		const generateAjv = value => {
			if (Array.isArray(value)) {
				return value.map(generateAjv);
			}

			if (value.schema) {
				value.schema = generateAjvSchema(value.schema, {schemas});
			}

			return value;
		};

		routes.forEach(function (route) {
			const {endpoint: e} = route;

			for (const prop in e) {
				e[prop] = getAst(e[prop]);
			}
		});

		var endpoints = routes.map(function (route) {
			const {endpoint: e} = route;

			for (const prop in e) {
				e[prop] = annotations[prop](
					generateAjv(e[prop]),
					{defaultMethod}
				);
			}

			return e;
		});

		ready = true;

		return endpoints;
	};

	if (parseEndpoints) {
		process.nextTick(Router.endpoints);
	}

	return Router;
}

class AdvExpressRouter {
	constructor({Router, router, ajv, defaultMethod, defaultCode}) {
		this.Router = Router;
		this.router = router;
		this.ajv = ajv;
		this.endpoint = {};
		this.defaultMethod = defaultMethod;
		this.defaultCode = defaultCode;
	}

	baseUrl(path) {
		this.endpoint.baseUrl = path;

		const {Router, router} = this;

		this.route = Router();
		this.route.stack = new StackArray();
		router.use(path, this.route);

		return this;
	}

	url(code) {
		this.endpoint.url = code;

		const {router} = this;
		const {method, path} = annotations.url(code, {defaultMethod: this.defaultMethod});

		this.method = method.toLowerCase();
		this.route = router.route(router.baseUrl() + path);
		this.route.stack = new StackArray();

		return this;
	}

	callback(callback) {
		this.route[this.method || 'use'](callback);

		return this;
	}

	then(callback) {
		this.ensureResultHandler();

		return this.callback(async (req, res, next) => {
			try {
				req._thenResult = await callback(req._thenResult || req);
				next();
			}
			catch (err) {
				next(err);
			}
		});
	}

	catch(callback) {
		this.ensureResultHandler();

		return this.callback(async (err, req, res, next) => {
			try {
				req._thenResult = await callback(err, req, res);
				next();
			}
			catch (err) {
				next(err);
			}
		});
	}

	ensureResultHandler() {
		if (this.resultHandler) return;

		this.resultHandler = (req, res) => {
			if (res.headersSent) return;

			res.json(req._thenResult);
		};

		this.callback(this.resultHandler);

		this.route.stack.lockLast();
	}

	validate(req, res) {
		const {ajv, endpoint: e} = this;

		if (e.params) {
			let {schema, validate} = e.params;

			if (!validate) {
				validate = e.params.validate = ajv.compile(schema);
			}

			if (!validate(req.params)) {
				throw new RequestValidationError(`Invalid URL params`, 'params', validate.errors);
			}
		}

		if (e.query) {
			let {schema, validate} = e.query;

			if (!validate) {
				validate = e.query.validate = ajv.compile(schema);
			}

			if (!validate(req.query)) {
				throw new RequestValidationError(`Invalid URL query`, 'query', validate.errors);
			}
		}

		if (e.body) {
			let {schema, validate} = e.body;

			if (!validate) {
				validate = e.body.validate = ajv.compile(schema);
			}

			if (!validate(req.body)) {
				throw new RequestValidationError(`Invalid request body`, 'body', validate.errors);
			}
		}

		if (e.response && e.response.length > 0) {
			return onResponse(e, ajv, res);
		}
	}

	ensureValidate() {
		if (this.validateHandler) return;

		this.validateHandler = (req, res, next) => {
			this.validate(req, res);
			next();
		};

		this.callback(this.validateHandler);
	}

	namespace(code) {
		this.endpoint.namespace = code;

		return this;
	}

	ns(code) {
		return this.namespace(code);
	}

	description(code) {
		this.endpoint.description = code;

		return this;
	}

	params(code) {
		this.ensureValidate();

		this.endpoint.params = annotations.params.prepare(code);

		return this;
	}

	query(code) {
		this.ensureValidate();

		this.endpoint.query = annotations.query.prepare(code);

		return this;
	}

	body(code) {
		this.ensureValidate();

		this.endpoint.body = annotations.body.prepare(code);

		return this;
	}

	response(code, schema) {
		if (arguments.length === 1) {
			schema = code;
			code = '';
		}

		this.ensureValidate();

		if (!this.endpoint.response) {
			this.endpoint.response = [];
		}

		this.endpoint.response.push(
			annotations.response.prepare(schema, {
				defaultCode: code || this.defaultCode
			})
		);

		return this;
	}

	schema(code) {
		this.endpoint.schema = this.endpoint.schema || [];
		this.endpoint.schema.push(
			annotations.schema.prepare(code)
		);

		return this;
	}

	call(code) {
		this.endpoint.call = code;

		return this;
	}
}

class StackArray extends Array {
	lockLast() {
		if (!this.alwaysLast) {
			Object.defineProperty(this, 'alwaysLast', {
				enumerable: false,
				writable: true,
			});
		}

		this.alwaysLast = this.last();
	}
	
	last() {
		return this[this.length - 1];
	}

	push(...callbacks) {
		if (!this.alwaysLast) {
			return super.push(...callbacks);
		}

		let index = this.indexOf(this.alwaysLast);

		if (index === -1) {
			throw new Error('StackArray: locked item was removed');
		}

		this.splice(index, 0, ...callbacks);

		return this.length;
	}
}

function onResponse(e, ajv, res) {
	if (res.headersSent) return;

	const originalJson = res.json;

	res.json = function jsonHook(data) {
		res.json = originalJson;

		if (res.headersSent) return res;

		validateJsonData(e, ajv, data, res.statusCode);

		return res.json(data);
	};
}

function validateJsonData(e, ajv, body, statusCode) {
	body = JSON.parse(JSON.stringify(body));

	for (let response of e.response) {
		let {code, schema, validate, validateCode} = response;

		if (code && statusCode && !validateCode) {
			validateCode = response.validateCode = ajv.compile(code);
		}

		if (validateCode && !validateCode(statusCode)) {
			continue;
		}

		if (!validate) {
			validate = response.validate = ajv.compile(schema);
		}

		if (validate(body)) {
			break;
		}
		else {
			throw new ResponseValidationError(`Invalid response body`, validate.errors);
		}
	}
}

function getAjv() {
	var Ajv = require('ajv');

	if (typeof Ajv.default === 'function') {
		Ajv = Ajv.default;
	}

	var ajv = new Ajv({coerceTypes: true});

	try {
		var formatsFound = !!require.resolve('ajv-formats');
	}
	catch (err) {}

	if (formatsFound) {
		require('ajv-formats')(ajv);
	}

	return ajv;
}

class ValidationError extends Error {
	constructor(message, errors) {
		super(message);

		this.name = "ValidationError";
		this.errors = errors;
	}
}

class RequestValidationError extends ValidationError {
	constructor(message, prop, errors) {
		super(message, errors);

		this.name = "RequestValidationError";
		this.property = prop;
	}
}

class ResponseValidationError extends ValidationError {
	constructor(message, errors) {
		super(message, errors);

		this.name = "ResponseValidationError";
	}
}

module.exports.ValidationError = ValidationError;
module.exports.RequestValidationError = RequestValidationError;
module.exports.ResponseValidationError = ResponseValidationError;