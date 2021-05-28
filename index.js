const annotations = require('api-doc-validator/lib/annotations');
const {getAstSchema, generateAjvSchema} = require('adv-parser');
const defaultSchemas = require('adv-parser/schemas');

module.exports = function extendExpress(express, options = {}) {
	extendApplication(express.application);
	extendRouter(express.Router, options);
};

module.exports.extendApplication = extendApplication;
module.exports.extendRouter = extendRouter;

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

		routes.push({endpoint: {baseUrl}});

		return this;
	};

	Router.url = function url(path) {
		var router = new AdvExpressRouter({router: this, ajv});

		routes.push(router);

		return router.url(path, {defaultMethod});
	};

	Router.schema = function (code) {
		routes.push({endpoint: {schema: [code]}});
	};

	Router.endpoints = function (force) {
		if (ready && !force) return routes.map(route => route.endpoint);

		const getAst = value => {
			if (Array.isArray(value)) {
				return value.forEach(getAst);
			}

			if (value.schema) {
				value.schema = getAstSchema(value.schema, {schemas});
			}
		};

		const generateAjv = value => {
			if (Array.isArray(value)) {
				return value.forEach(generateAjv);
			}

			if (value.schema) {
				value.schema = generateAjvSchema(value.schema, {schemas});
			}
		};

		routes.forEach(function (route) {
			const {endpoint} = route;

			for (const prop in endpoint) {
				var value = endpoint[prop];
				var annotation = annotations[prop];

				if (annotation.prepare) {
					value = Array.isArray(value) ? value.map(annotation.prepare) : annotation.prepare(value);
				}

				getAst(value);

				endpoint[prop] = value;
			}
		});

		var endpoints = routes.map(function (route) {
			const {endpoint} = route;

			for (const prop in endpoint) {
				var value = endpoint[prop];
				var annotation = annotations[prop];

				generateAjv(value);

				endpoint[prop] = annotation(value, {defaultMethod});
			}

			return endpoint;
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
	constructor({router, ajv}) {
		this.router = router;
		this.ajv = ajv;
		this.endpoint = {};
	}

	url(code, options = {}) {
		this.endpoint.url = code;

		const {router} = this;
		const {method, path} = annotations.url(code, options);

		this.method = method.toLowerCase();

		const route = this.route = router.route(router.baseUrl() + path);

		this.stack = new StackArray();
		this.stack.push(...route.stack);
		route.stack = this.stack;

		this.callback((req, res, next) => {
			this.validate(req, res);
			next();
		});

		return this;
	}

	callback(callback) {
		this.route[this.method](callback);

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

		this.stack.lockLast();
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
		this.endpoint.params = code;

		return this;
	}

	query(code) {
		this.endpoint.query = code;

		return this;
	}

	body(code) {
		this.endpoint.body = code;

		return this;
	}

	response(code) {
		this.endpoint.response = this.endpoint.response || [];
		this.endpoint.response.push(code);

		return this;
	}

	schema(code) {
		this.endpoint.schema = this.endpoint.schema || [];
		this.endpoint.schema.push(code);

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