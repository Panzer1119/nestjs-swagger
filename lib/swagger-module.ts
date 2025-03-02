import { INestApplication } from '@nestjs/common';
import { HttpServer } from '@nestjs/common/interfaces/http/http-server.interface';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as jsyaml from 'js-yaml';
import {
  OpenAPIObject,
  SwaggerCustomOptions,
  SwaggerDocumentOptions
} from './interfaces';
import { SwaggerScanner } from './swagger-scanner';
import {
  buildSwaggerHTML,
  buildSwaggerInitJS,
  swaggerAssetsAbsoluteFSPath
} from './swagger-ui';
import { assignTwoLevelsDeep } from './utils/assign-two-levels-deep';
import { getGlobalPrefix } from './utils/get-global-prefix';
import { validatePath } from './utils/validate-path.util';

export class SwaggerModule {
  public static createDocument(
    app: INestApplication,
    config: Omit<OpenAPIObject, 'paths'>,
    options: SwaggerDocumentOptions = {}
  ): OpenAPIObject {
    const swaggerScanner = new SwaggerScanner();
    const document = swaggerScanner.scanApplication(app, options);

    document.components = assignTwoLevelsDeep(
      {},
      config.components,
      document.components
    );

    return {
      openapi: '3.0.0',
      paths: {},
      ...config,
      ...document
    };
  }

  private static serveStatic(finalPath: string, app: INestApplication) {
    const httpAdapter = app.getHttpAdapter();

    if (httpAdapter && httpAdapter.getType() === 'fastify') {
      (app as NestFastifyApplication).useStaticAssets({
        root: swaggerAssetsAbsoluteFSPath,
        prefix: `${finalPath}/`,
        decorateReply: false
      });
    } else {
      (app as NestExpressApplication).useStaticAssets(
        swaggerAssetsAbsoluteFSPath,
        { prefix: finalPath }
      );
    }
  }

  private static serveDocuments(
    finalPath: string,
    httpAdapter: HttpServer,
    swaggerInitJS: string,
    yamlDocument: string,
    jsonDocument: string,
    html: string
  ) {
    httpAdapter.get(`${finalPath}/swagger-ui-init.js`, (req, res) => {
      res.type('application/javascript');
      res.send(swaggerInitJS);
    });

    httpAdapter.get(finalPath, (req, res) => {
      res.type('text/html');
      res.send(html);
    });

    // fastify doesn't resolve 'routePath/' -> 'routePath', that's why we handle it manually
    try {
      httpAdapter.get(finalPath + '/', (req, res) => {
        res.type('text/html');
        res.send(html);
      });
    } catch (err) {
      /**
       * When Fastify adapter is being used with the "ignoreTrailingSlash" configuration option set to "true",
       * declaration of the route "finalPath/" will throw an error because of the following conflict:
       * Method '${method}' already declared for route '${path}' with constraints '${JSON.stringify(constraints)}.
       * We can simply ignore that error here.
       */
    }

    httpAdapter.get(`${finalPath}-json`, (req, res) => {
      res.type('application/json');
      res.send(jsonDocument);
    });

    httpAdapter.get(`${finalPath}-yaml`, (req, res) => {
      res.type('text/yaml');
      res.send(yamlDocument);
    });
  }

  public static setup(
    path: string,
    app: INestApplication,
    document: OpenAPIObject,
    options?: SwaggerCustomOptions
  ) {
    const globalPrefix = getGlobalPrefix(app);
    const finalPath = validatePath(
      options?.useGlobalPrefix && globalPrefix && !globalPrefix.match(/^(\/?)$/)
        ? `${globalPrefix}${validatePath(path)}`
        : path
    );

    const yamlDocument = jsyaml.dump(document, { skipInvalid: true });
    const jsonDocument = JSON.stringify(document);
    const html = buildSwaggerHTML(finalPath, document, options);
    const swaggerInitJS = buildSwaggerInitJS(document, options);
    const httpAdapter = app.getHttpAdapter();

    SwaggerModule.serveDocuments(
      finalPath,
      httpAdapter,
      swaggerInitJS,
      yamlDocument,
      jsonDocument,
      html
    );

    SwaggerModule.serveStatic(finalPath, app);
  }
}
