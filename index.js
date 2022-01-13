const annotations = require('api-doc-validator/lib/annotations');
const {getAstSchema, generateAjvSchema} = require('adv-parser');
const defaultSchemas = require('adv-parser/schemas');
const cloneDeepWith = require('lodash.clonedeepwith');

module.exports = extendExpress;
module.exports.extendApplication = extendApplication;
module.exports.extendRouter = extendRouter;

function extendExpress(express, options = {}) {
	const application = extendApplication(express.application);
	const Router = extendRouter(express.Router, options);

	return {
		application,
		Router,
	};
}

function extendApplication(app) {
	for (const method of ['baseUrl', 'url', 'schema', 'endpoints']) {
		app[method] = function (...args) {
			this.lazyrouter();
			return this._router[method](...args);
		};
	}

	return app;
}

function extendRouter(
	Router,
	{
		schemas = {...defaultSchemas},
		ajv,
		requestAjv,
		responseAjv,
		parseEndpoints = true,
		defaultMethod = 'GET',
		defaultCode = 200,
	} = {}
) {
	const routes = [];
	var ready = false;

	if (!requestAjv) {
		requestAjv = ajv || getAjv();
	}

	if (!responseAjv) {
		responseAjv = ajv || getAjv();
	}

	Router.baseUrl = function (baseUrl) {
		if (arguments.length === 0) return this._baseUrl || '';

		if (this._baseUrl) {
			throw new Error('Router: baseUrl already set');
		}

		this._baseUrl = baseUrl;

		const router = new AdvExpressRouter({
			Router,
			router: this,
			requestAjv,
			responseAjv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.baseUrl(baseUrl);
	};

	Router.url = function url(path) {
		const router = new AdvExpressRouter({
			Router,
			router: this,
			requestAjv,
			responseAjv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.url(path);
	};

	Router.schema = function (...args) {
		const router = new AdvExpressRouter({
			Router,
			router: this,
			requestAjv,
			responseAjv,
			defaultMethod,
			defaultCode,
		});

		routes.push(router);

		return router.schema(...args);
	};

	Router.endpoints = function (force) {
		if (ready && !force) return routes.map(route => route.endpoint);

		const getAst = value => {
			if (Array.isArray(value)) {
				return value.map(getAst);
			}

			if (value.schema && typeof value.schema !== 'object') {
				value.schema = getAstSchema(value.schema, {schemas});
				value.schema.ast = true;
			}

			return value;
		};

		const generateAjv = value => {
			if (Array.isArray(value)) {
				return value.map(generateAjv);
			}

			if (value.schema && value.schema.ast) {
				value.schema = generateAjvSchema(value.schema, {schemas});
			}

			return value;
		};

		for (const {endpoint: e} of routes) {
			for (const prop in e) {
				e[prop] = getAst(e[prop]);
			}
		}

		const endpoints = routes.map(function (route) {
			const e = {...route.endpoint};

			for (const prop in e) {
				e[prop] = annotations[prop](
					generateAjv(e[prop]),
					{defaultMethod}
				);
			}

			Object.defineProperty(e, 'route', {
				enumerable: false,
				writable: false,
				value: () => route,
			});

			Object.defineProperty(e, 'router', {
				enumerable: false,
				writable: false,
				value: () => route.router,
			});

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
	constructor({Router, router, requestAjv, responseAjv, defaultMethod, defaultCode}) {
		this.Router = Router;
		this.router = router;
		this.requestAjv = requestAjv;
		this.responseAjv = responseAjv;
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
			}
			catch (err) {
				next(err);
				return;
			}

			next();
		});
	}

	catch(callback) {
		this.ensureResultHandler();

		return this.callback(async (err, req, res, next) => {
			try {
				req._thenResult = await callback(err, req, res);
			}
			catch (err) {
				next(err);
				return;
			}

			next();
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
		const {requestAjv, responseAjv, endpoint: e} = this;

		if (e.params) {
			let {schema, validate} = e.params;

			if (!validate) {
				validate = e.params.validate = requestAjv.compile(schema);
			}

			const params = stripUndefined(req.params);

			if (!validate(params)) {
				throw new RequestValidationError(`Invalid URL params`, 'params', validate.errors);
			}

			for (const prop in params) {
				req.params[prop] = params[prop];
			}
		}

		if (e.query) {
			let {schema, validate} = e.query;

			if (!validate) {
				validate = e.query.validate = requestAjv.compile(schema);
			}

			if (!validate(req.query)) {
				throw new RequestValidationError(`Invalid URL query`, 'query', validate.errors);
			}
		}

		if (e.body) {
			let {schema, validate} = e.body;

			if (!validate) {
				validate = e.body.validate = requestAjv.compile(schema);
			}

			if (!validate(req.body)) {
				throw new RequestValidationError(`Invalid request body`, 'body', validate.errors);
			}
		}

		if (e.file) {
			let {schema, validate} = e.file;

			if (!validate) {
				validate = e.file.validate = requestAjv.compile(schema);
			}

			if (!validate(req.file)) {
				throw new RequestValidationError(`Invalid request file`, 'file', validate.errors);
			}
		}

		if (e.files) {
			let {schema, validate} = e.files;

			if (!validate) {
				validate = e.files.validate = requestAjv.compile(schema);
			}

			if (!validate(req.files)) {
				throw new RequestValidationError(`Invalid request files`, 'files', validate.errors);
			}
		}

		if (e.response && e.response.length > 0) {
			return onResponse(e, responseAjv, res);
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

	namespace(name) {
		this.endpoint.namespace = name;

		return this;
	}

	ns(name) {
		return this.namespace(name);
	}

	description(text) {
		this.endpoint.description = text;

		return this;
	}

	call(code) {
		this.endpoint.call = prepare('call', code);

		return this;
	}

	params(code) {
		this.ensureValidate();

		this.endpoint.params = prepare('params', code);

		return this;
	}

	query(code) {
		this.ensureValidate();

		this.endpoint.query = prepare('query', code);

		return this;
	}

	body(code) {
		this.ensureValidate();

		this.endpoint.body = prepare('body', code);

		return this;
	}

	file(code) {
		this.ensureValidate();

		this.endpoint.file = prepare('file', code);

		return this;
	}

	files(code) {
		this.ensureValidate();

		this.endpoint.files = prepare('files', code);

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

		if (schema && typeof schema === 'object') {
			schema = '!!' + JSON.stringify(schema);
		}

		this.endpoint.response.push(
			annotations.response.prepare(schema, {
				defaultCode: code || this.defaultCode
			})
		);

		return this;
	}

	schema(code) {
		if (arguments.length === 2 && typeof arguments[1] === 'object') {
			code = `${arguments[0]} = !!${JSON.stringify(arguments[1])}`;
		}

		this.endpoint.schema = this.endpoint.schema || [];
		this.endpoint.schema.push(
			annotations.schema.prepare(code)
		);

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

		data = validateJsonData(data, e, ajv, res.statusCode);

		return res.json(data);
	};
}

function validateJsonData(data, e, ajv, statusCode) {
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

		data = toJSON(data);

		if (validate(data)) {
			break;
		}
		else {
			throw new ResponseValidationError(`Invalid response body`, validate.errors);
		}
	}

	return data;
}

function getAjv() {
	var Ajv = require('ajv');

	if (typeof Ajv.default === 'function') {
		Ajv = Ajv.default;
	}

	const ajv = new Ajv({coerceTypes: true});

	try {
		var formatsFound = !!require.resolve('ajv-formats');
	}
	catch (err) {}

	if (formatsFound) {
		require('ajv-formats')(ajv);
	}

	return ajv;
}

function toJSON(data) {
	return cloneDeepWith(
		data,
		v => {
			if (!v || typeof v !== 'object' || typeof v.toJSON !== 'function') return;

			const json = v.toJSON();

			if (json === v) return;

			return toJSON(json);
		}
	);
}

function prepare(type, code) {
	if (code && code.toJSON) {
		code = code.toJSON();
	}

	const {prepare} = annotations[type];

	return prepare ? prepare(code) : code;
}

function stripUndefined(source) {
	const target = {};

	for (const name in source) {
		const value = source[name];

		if (typeof value === 'undefined') continue;

		target[name] = value;
	}

	return target;
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

module.exports.Router = AdvExpressRouter;
module.exports.ValidationError = ValidationError;
module.exports.RequestValidationError = RequestValidationError;
module.exports.ResponseValidationError = ResponseValidationError;