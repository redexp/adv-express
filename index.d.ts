import {Application, Router as ExpressRouter, RouterOptions, Request, Response, NextFunction} from 'express';
import Express = require('express');
import {Code, Schemas} from 'adv-parser';
import Ajv, {JSONType, ErrorObject} from 'ajv';

declare function extendExpress(express: typeof Express, options?: Options): ExtendedExpress;

export type Options = ExtendRouterOptions;

export default extendExpress;

export declare function extendApplication(application: Application): ExtendedApplication;

export declare function extendRouter(router: typeof ExpressRouter, options?: ExtendRouterOptions): ExtendedRouter;

export interface ExtendRouterOptions {
	schemas?: Schemas,
	ajv?: typeof Ajv,
	requestAjv?: typeof Ajv,
	responseAjv?: typeof Ajv,
	parseEndpoints?: boolean,
	defaultMethod?: 'GET' | 'POST',
	defaultCode?: number,
}

interface ExtendedExpress {
	application: ExtendedApplication,
	Router: ExtendedRouter,
}

interface ExtendedApplication extends Application {
	baseUrl(url: string): AdvExpressRouter;
	url(path: string): AdvExpressRouter;
	schema(code: Schema): AdvExpressRouter;
	endpoints(force?: boolean): Endpoint[];
}

interface ExtendedRouter extends ExpressRouter {
	(options?: RouterOptions): ExtendedRouter;

	baseUrl(url: string): AdvExpressRouter;
	url(path: string): AdvExpressRouter;
	schema(code: Schema): AdvExpressRouter;
	endpoints(force?: boolean): Endpoint[];
}

declare class AdvExpressRouter {
	constructor(options: {
		Router: ExtendedRouter,
		router: typeof ExpressRouter,
		requestAjv: typeof Ajv,
		responseAjv: typeof Ajv,
		defaultMethod: string,
		defaultCode: number,
	});

	namespace(ns: string): this;
	ns(ns: string): this;
	description(text: string): this;
	schema(schema: Schema): this;
	schema(name: string, schema: JsonSchema): this;
	baseUrl(url: string): this;
	url(path: string): this;
	call(code: Code): this;
	params(schema: Schema): this;
	query(schema: Schema): this;
	body(schema: Schema): this;
	file(schema: Schema): this;
	files(schema: Schema): this;
	callback(callback: CallbackHandler): this;
	then(resolver: RouterThenHandler): this;
	catch(errorHandler: RouterCatchHandler): this;
	response(code: number, schema: Schema): this;
	response(schema: Schema): this;
}

export const Router: typeof AdvExpressRouter;

export type Schema = Code | JsonSchema | {toJSON(): Schema, [prop: string]: any};
export type JsonSchema = {type: JSONType | JSONType[], [prop: string]: any};
export type CallbackHandler = ((req: Request, res: Response, next: NextFunction) => void) | ((err: Error, req: Request, res: Response, next: NextFunction) => void);
export type RouterThenHandler = (data: Request | any) => any;
export type RouterCatchHandler = (data: Error | any, req: Request, res: Response) => any;

interface Endpoint {
	namespace: string,
	url: {
		method: string,
		path: string,
	},
	[prop: string]: any,
}

export declare class ValidationError extends Error {
	name: string;
	errors: ErrorObject[];

	constructor(message: string, errors: ErrorObject[]);
}

export declare class RequestValidationError extends ValidationError {
	name: "RequestValidationError";
	property: string;

	constructor(message: string, property: string, errors: ErrorObject[]);
}

export declare class ResponseValidationError extends ValidationError {
	name: "RequestValidationError";
}