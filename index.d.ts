import {Application, Router, RouterOptions, Request, Response, NextFunction} from 'express';
import Express = require('express');
import {Code, Schemas} from 'adv-parser';
import Ajv, {JSONType} from 'ajv';

declare function extendExpress(express: typeof Express, options?: Options): ExtendedExpress;

export type Options = ExtendRouterOptions;

export default extendExpress;

export declare function extendApplication(application: Application): ExtendedApplication;

export declare function extendRouter(router: typeof Router, options?: ExtendRouterOptions): ExtendedRouter;

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

interface ExtendedRouter extends Router {
	(options?: RouterOptions): ExtendedRouter;

	baseUrl(url: string): AdvExpressRouter;
	url(path: string): AdvExpressRouter;
	schema(code: Schema): AdvExpressRouter;
	endpoints(force?: boolean): Endpoint[];
}

declare class AdvExpressRouter {
	constructor(options: {
		Router: ExtendedRouter,
		router: typeof Router,
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

export type Schema = Code | JsonSchema;
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