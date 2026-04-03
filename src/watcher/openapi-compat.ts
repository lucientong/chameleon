/**
 * OpenAPI compatibility re-export for the watcher module.
 * This file avoids circular dependency issues by providing a
 * clean import path for the OpenAPI parser within the watcher layer.
 */

export { parseOpenAPIFile } from '../parsers/openapi.js';
