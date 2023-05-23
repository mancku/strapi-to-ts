import { pascalCase } from "pascal-case";
import path from 'path';
import prettier from 'prettier';
import defaultSchemaInfo, { SchemaInfo } from "../models/schemaInfo";
import { SchemaSource } from "../models/schemaSource";
import { SchemaType } from "../models/schemaType";
import { pluginName } from "../register";
import { CommonHelpers } from "./commonHelpers";
import { FileHelpers } from "./fileHelpers";

export class InterfaceBuilder {

  private prettierOptions: prettier.Options | undefined;
  constructor(private commonHelpers: CommonHelpers) {
    this.prettierOptions = this.commonHelpers.getPrettierOptions();
  }

  public convertSchemaToInterfaces(schema: SchemaInfo, schemas: SchemaInfo[]) {
    console.log('Converting schema', schema.schemaPath);
    this.convertToInterface(schema, schemas, SchemaType.Standard);
    this.convertToInterface(schema, schemas, SchemaType.Plain);
    this.convertToInterface(schema, schemas, SchemaType.NoRelations);
    if (schema.source === SchemaSource.Api) {
      this.convertToInterface(schema, schemas, SchemaType.AdminPanelLifeCycle);
    }
    schema.dependencies = [...new Set(schema.dependencies)];
  }

  public buildInterfacesFileContent(schema: SchemaInfo) {
    let interfacesFileContent = `// Interface automatically generated by ${pluginName}\n\n`;
    if (schema.dependencies?.length > 0) {
      interfacesFileContent += schema.dependencies.join('\n');
      interfacesFileContent += '\n\n';
    }
    let interfacesText = schema.interfaceAsText;
    interfacesText += `\n${schema.plainInterfaceAsText}`;
    interfacesText += `\n${schema.noRelationsInterfaceAsText}`;
    interfacesText += `\n${schema.adminPanelLifeCycleRelationsInterfaceAsText}`;
    interfacesText = interfacesText.replace('\n\n', '\n');
    interfacesFileContent += interfacesText;

    if (this.prettierOptions) {
      interfacesFileContent = prettier.format(interfacesFileContent, this.prettierOptions);
    }
    return interfacesFileContent;
  }

  public generateCommonSchemas(commonFolderModelsPath: string): SchemaInfo[] {
    const result: SchemaInfo[] = [];
    this.addCommonSchema(result, commonFolderModelsPath, 'Payload',
      `export interface Payload<T> {
      data: T;
      meta: {
        pagination?: {
          page: number;
          pageSize: number;
          pageCount: number;
          total: number;
        }
      };
    }
    `);

    this.addCommonSchema(result, commonFolderModelsPath, 'User',
      `export interface User {
      id: number;
      attributes: {
        username: string;
        email: string;
        provider: string;
        confirmed: boolean;
        blocked: boolean;
        createdAt: Date;
        updatedAt: Date;
      }
    }
    `, `export interface User_Plain {
      id: number;
      username: string;
      email: string;
      provider: string;
      confirmed: boolean;
      blocked: boolean;
      createdAt: Date;
      updatedAt: Date;
    }
    `);

    this.addCommonSchema(result, commonFolderModelsPath, 'MediaFormat',
      `export interface MediaFormat {
      name: string;
      hash: string;
      ext: string;
      mime: string;
      width: number;
      height: number;
      size: number;
      path: string;
      url: string;
    }
    `);

    this.addCommonSchema(result, commonFolderModelsPath, 'Media',
      `import { MediaFormat } from './MediaFormat';
    export interface Media {
      id: number;
      attributes: {
        name: string;
        alternativeText: string;
        caption: string;
        width: number;
        height: number;
        formats: { thumbnail: MediaFormat; medium: MediaFormat; small: MediaFormat; };
        hash: string;
        ext: string;
        mime: string;
        size: number;
        url: string;
        previewUrl: string;
        provider: string;
        createdAt: Date;
        updatedAt: Date;
      }
    }
    `);

    this.addCommonSchema(result, commonFolderModelsPath, 'AdminPanelRelationPropertyModification',
      `export interface AdminPanelRelationPropertyModification<T> {
      connect: T[];
      disconnect: T[];
    }
    `);

    this.addCommonSchema(result, commonFolderModelsPath, 'BeforeRunEvent',
      `import { Event } from '@strapi/database/lib/lifecycles/index';
  
    export interface BeforeRunEvent<TState> extends Event {
      state: TState;
    }`);

    this.addCommonSchema(result, commonFolderModelsPath, 'AfterRunEvent',
      `import { BeforeRunEvent } from './BeforeRunEvent';
  
    export interface AfterRunEvent<TState, TResult> extends BeforeRunEvent<TState> {
      result: TResult;
    }
    `);

    return result;
  }

  private convertToInterface(schemaInfo: SchemaInfo, allSchemas: SchemaInfo[], schemaType: SchemaType) {
    if (!schemaInfo.schema) {
      console.log(`Skipping ${schemaInfo.schemaPath}: schema is empty.`);
      return null;
    }

    const interfaceDependencies: any[] = [];
    let interfaceText = this.buildInterfaceText(schemaInfo, schemaType, interfaceDependencies);

    for (const dependency of interfaceDependencies) {
      const dependencySchemaInfo = allSchemas.find((x: SchemaInfo) => {
        return x.pascalName === dependency.type.replace('_Plain', '').replace('_NoRelations', '');
      });

      let importPath = schemaInfo.destinationFolder;
      if (dependencySchemaInfo) {
        importPath = FileHelpers.getRelativePath(importPath, dependencySchemaInfo.destinationFolder);
        const fileName: string = this.commonHelpers.getFileNameFromSchema(dependencySchemaInfo, false);
        importPath = this.getImportPath(importPath, fileName);
      }
      const dependencyImport: string = `import { ${dependency.type} } from '${importPath}';`;
      this.commonHelpers.printVerboseLog(`Adding dependency to ${schemaInfo.pascalName}`, dependencyImport);
      schemaInfo.dependencies.push(dependencyImport);
    }

    if (schemaType === SchemaType.Standard) {
      schemaInfo.interfaceAsText = interfaceText;
    } else if (schemaType === SchemaType.Plain) {
      schemaInfo.plainInterfaceAsText = interfaceText;
    } else if (schemaType === SchemaType.NoRelations) {
      schemaInfo.noRelationsInterfaceAsText = interfaceText;
    } else if (schemaType === SchemaType.AdminPanelLifeCycle) {
      schemaInfo.adminPanelLifeCycleRelationsInterfaceAsText = interfaceText;
    }
  }

  private isOptional(attributeValue): boolean {
    // arrays are never null
    if (attributeValue.relation === 'oneToMany' || attributeValue.repeatable) {
      return false;
    }
    return attributeValue.required !== true;
  }

  private buildInterfaceText(schemaInfo: SchemaInfo, schemaType: SchemaType, interfaceDependencies: any[]) {
    let interfaceName: string = schemaInfo.pascalName;
    if (schemaType === SchemaType.Plain) {
      interfaceName += '_Plain';
    } else if (schemaType === SchemaType.NoRelations) {
      interfaceName += '_NoRelations';
    } else if (schemaType === SchemaType.AdminPanelLifeCycle) {
      interfaceName += '_AdminPanelLifeCycle';
    }

    let interfaceText = `export interface ${interfaceName} {\n`;
    if (schemaInfo.source === SchemaSource.Api) {
      interfaceText += `  id: number;\n`;
    }

    let indentation = '  ';
    if (schemaInfo.source === SchemaSource.Api && schemaType === SchemaType.Standard) {
      interfaceText += `  attributes: {\n`;
      indentation += '  ';
    }

    const attributes = Object.entries(schemaInfo.schema.attributes);
    for (const attribute of attributes) {
      let propertyName = attribute[0];
      const attributeValue: any = attribute[1];
      if (this.isOptional(attributeValue))
        propertyName += '?';
      let propertyType;
      let propertyDefinition;
      // -------------------------------------------------
      // Relation
      // -------------------------------------------------
      if (attributeValue.type === 'relation') {
        propertyType = attributeValue.target.includes('::user')
          ? 'User'
          : `${pascalCase(attributeValue.target.split('.')[1])}`;

        if (schemaType === SchemaType.Plain || schemaType === SchemaType.AdminPanelLifeCycle) {
          propertyType += '_Plain';
        }

        interfaceDependencies.push({
          type: propertyType,
        });
        const isArray = attributeValue.relation.endsWith('ToMany');
        const bracketsIfArray = isArray ? '[]' : '';

        //TODO review if this should be that way
        if (schemaType === SchemaType.Standard) {
          propertyDefinition = `${indentation}${propertyName}: { data: ${propertyType}${bracketsIfArray} };\n`;
        } else if (schemaType === SchemaType.Plain) {
          propertyDefinition = `${indentation}${propertyName}: ${propertyType}${bracketsIfArray};\n`;
        } else if (schemaType === SchemaType.NoRelations) {
          propertyDefinition = `${indentation}${propertyName}: number${bracketsIfArray};\n`;
        } else if (schemaType === SchemaType.AdminPanelLifeCycle) {
          propertyDefinition = `${indentation}${propertyName}: AdminPanelRelationPropertyModification<${propertyType}>${bracketsIfArray};\n`;
          interfaceDependencies.push({
            type: 'AdminPanelRelationPropertyModification',
          });
        }
      }



      // -------------------------------------------------
      // Component
      // -------------------------------------------------
      else if (attributeValue.type === 'component') {
        propertyType =
          attributeValue.target === 'plugin::users-permissions.user'
            ? 'User'
            : pascalCase(attributeValue.component.split('.')[1]);

        if (schemaType === SchemaType.Plain || schemaType === SchemaType.AdminPanelLifeCycle) {
          propertyType += '_Plain';
        }
        if (schemaType === SchemaType.NoRelations) {
          propertyType += '_NoRelations';
        }
        interfaceDependencies.push({
          type: propertyType,
        });
        const isArray = attributeValue.repeatable;
        const bracketsIfArray = isArray ? '[]' : '';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType}${bracketsIfArray};\n`;
      }



      // -------------------------------------------------
      // Dynamic zone
      // -------------------------------------------------
      else if (attributeValue.type === 'dynamiczone') {
        // TODO
        propertyType = 'any';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Media
      // -------------------------------------------------
      else if (attributeValue.type === 'media') {
        propertyType = 'Media';
        interfaceDependencies.push({
          type: propertyType,
        });

        const bracketsIfArray = attributeValue.multiple ? '[]' : '';
        if (schemaType === SchemaType.Standard) {
          propertyDefinition = `${indentation}${propertyName}: { data: ${propertyType}${bracketsIfArray} };\n`;
        } else if (schemaType === SchemaType.Plain) {
          propertyDefinition = `${indentation}${propertyName}: ${propertyType}${bracketsIfArray};\n`;
        } else if (schemaType === SchemaType.NoRelations) {
          propertyDefinition = `${indentation}${propertyName}: number${bracketsIfArray};\n`;
        } else if (schemaType === SchemaType.AdminPanelLifeCycle) {
          propertyDefinition = `${indentation}${propertyName}: AdminPanelRelationPropertyModification<${propertyType}>${bracketsIfArray};\n`;

          interfaceDependencies.push({
            type: 'AdminPanelRelationPropertyModification',
          });
        }
      }



      // -------------------------------------------------
      // Enumeration
      // -------------------------------------------------
      else if (attributeValue.type === 'enumeration') {
        const enumOptions = attributeValue.enum.map(v => `'${v}'`).join(' | ');
        propertyDefinition = `${indentation}${propertyName}: ${enumOptions};\n`;
      }



      // -------------------------------------------------
      // Text, RichText, Email, UID
      // -------------------------------------------------
      else if (attributeValue.type === 'string' ||
        attributeValue.type === 'text' ||
        attributeValue.type === 'richtext' ||
        attributeValue.type === 'email' ||
        attributeValue.type === 'password' ||
        attributeValue.type === 'uid') {
        propertyType = 'string';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Json
      // -------------------------------------------------
      else if (attributeValue.type === 'json') {
        propertyType = 'any';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Password
      // -------------------------------------------------
      else if (attributeValue.type === 'password') {
        propertyDefinition = '';
      }



      // -------------------------------------------------
      // Number
      // -------------------------------------------------
      else if (attributeValue.type === 'integer' ||
        attributeValue.type === 'biginteger' ||
        attributeValue.type === 'decimal' ||
        attributeValue.type === 'float') {
        propertyType = 'number';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Date
      // -------------------------------------------------
      else if (attributeValue.type === 'date' || attributeValue.type === 'datetime' || attributeValue.type === 'time') {
        propertyType = 'Date';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Boolean
      // -------------------------------------------------
      else if (attributeValue.type === 'boolean') {
        propertyType = 'boolean';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }



      // -------------------------------------------------
      // Others
      // -------------------------------------------------
      else {
        propertyType = 'any';
        propertyDefinition = `${indentation}${propertyName}: ${propertyType};\n`;
      }
      interfaceText += propertyDefinition;
    }
    // -------------------------------------------------
    // Localization
    // -------------------------------------------------
    if (schemaInfo.schema.pluginOptions?.i18n?.localized) {
      interfaceText += `${indentation}locale: string;\n`;
      if (schemaType === SchemaType.Standard) {
        interfaceText += `${indentation}localizations?: { data: ${schemaInfo.pascalName}[] };\n`;
      } else {
        interfaceText += `${indentation}localizations?: ${schemaInfo.pascalName}[];\n`;
      }
    }
    if (schemaInfo.source === SchemaSource.Api && schemaType === SchemaType.Standard) {
      interfaceText += `  };\n`;
    }

    interfaceText += '}\n';
    return interfaceText;
  }

  private getImportPath(importPath: string, fileName: string): string {
    let result = '';
    if (importPath === './') {
      result = `./${fileName}`;
    } else {
      result = path.join(importPath, fileName);
    }

    if (CommonHelpers.isWindows()) {
      result = result.replaceAll('\\', '/');
    }

    return result;
  }

  private addCommonSchema(schemas: SchemaInfo[], commonFolderModelsPath: string, pascalName: string,
    interfaceAsText: string, plainInterfaceAsText?: string): void {
    const schemaInfo: SchemaInfo = Object.assign({}, defaultSchemaInfo);
    schemaInfo.destinationFolder = commonFolderModelsPath;
    schemaInfo.pascalName = pascalName;
    schemaInfo.interfaceAsText = interfaceAsText;
    if (plainInterfaceAsText) {
      schemaInfo.plainInterfaceAsText = plainInterfaceAsText;
    }
    schemas.push(schemaInfo);
  }
}