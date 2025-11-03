import { diff as deepDiff, Diff } from 'deep-diff';
import { Document, parseAllDocuments, Node, YAMLMap, Scalar } from 'yaml';
import { updateObject, addInstructions as addObjectInstructions, CommentInstructions, MergeInstructions, findKeyByProxy } from '@hiscojs/object-updater';

// Type definitions for deep-diff
interface DiffEdit<LHS = unknown, RHS = unknown> {
  kind: 'E';
  path?: (string | number)[];
  lhs: LHS;
  rhs: RHS;
}

interface DiffNew<RHS = unknown> {
  kind: 'N';
  path?: (string | number)[];
  rhs: RHS;
}

interface DiffDeleted<LHS = unknown> {
  kind: 'D';
  path?: (string | number)[];
  lhs: LHS;
}

interface DiffArray<RHS = unknown> {
  kind: 'A';
  path?: (string | number)[];
  index: number;
  item: {
    kind: 'N' | 'D';
    rhs?: RHS;
    lhs?: RHS;
  };
}

type DiffType<LHS = unknown, RHS = unknown> = DiffEdit<LHS, RHS> | DiffNew<RHS> | DiffDeleted<LHS> | DiffArray<RHS>;

// Type for YAML node with comments
interface YAMLNodeWithComment {
  commentBefore?: string;
  type?: string;
  items?: unknown[] | Map<unknown, unknown>;
  flow?: boolean;
}

/**
 * YAML formatting instructions for controlling output style
 */
interface YAMLFormatInstructions {
  /**
   * Control the YAML formatting style:
   * - true: Use flow style (JSON-like compact format) e.g., {key: value} or [1, 2, 3]
   * - false: Use block style (traditional YAML format) e.g., key: value on separate lines
   */
  flow?: boolean;
  /**
   * Control the YAML formatting style for individual array items
   * Array of booleans corresponding to each item in the array
   * - true: Use flow style for this item
   * - false: Use block style for this item
   */
  flowItems?: boolean[];
  /**
   * Hide null values in YAML output
   * When true, renders as "key:" instead of "key: null"
   * Useful for properties that should exist but have no value
   */
  hideNull?: boolean;
}

/**
 * YAML anchor and alias instructions for reusable content
 */
interface AnchorInstructions {
  /**
   * Create an anchor on this property
   * @example 'default-config' -> creates &default-config
   */
  anchor?: string;

  /**
   * Rename an existing anchor globally throughout the document
   * When combined with 'anchor', performs a document-wide rename of all references
   * @example renameFrom: 'old-name' with anchor: 'new-name' -> renames &old-name to &new-name and all *old-name to *new-name
   */
  renameFrom?: string;

  /**
   * Create a simple alias reference to an anchor
   * Property value will be replaced with *anchor-name
   * @example alias: 'default-config' -> property: *default-config
   */
  alias?: string;

  /**
   * Merge with an anchor using YAML merge key (<<:)
   * Allows adding/overriding properties while inheriting from anchor
   * @example mergeAnchor: 'defaults' -> property: { <<: *defaults, ...other props }
   */
  mergeAnchor?: string;

  /**
   * Create anchors for specific array items
   * Key is the array index, value is the anchor name
   * @example anchors: { 0: 'first-item', 2: 'third-item' }
   */
  anchors?: Record<number, string>;

  /**
   * Create alias references for array items
   * Array of anchor names, one per item
   * @example aliases: ['default', 'custom', 'default']
   */
  aliases?: string[];
}

/**
 * Combined instructions that include comments, YAML formatting, anchors, and merge strategies
 */
interface YAMLInstructions extends CommentInstructions, YAMLFormatInstructions, AnchorInstructions, MergeInstructions {}

/**
 * Schema property definition for a single property
 */
interface SchemaProperty extends YAMLInstructions {
  /**
   * Type of the property (for arrays)
   */
  type?: 'array';

  /**
   * Nested properties (for objects)
   */
  properties?: Record<string, SchemaProperty>;

  /**
   * Array item instructions (for arrays)
   * Each item in the array represents instructions for that index
   */
  items?: SchemaProperty[];
}

/**
 * Schema definition for YAML structure
 * Provides a declarative way to define instructions for the entire document
 */
interface YAMLSchema {
  /**
   * Top-level properties and their instructions
   */
  properties?: Record<string, SchemaProperty>;
}

/**
 * Extended addInstructions that supports YAML-specific formatting options
 * Adds support for the 'flow' property to control JSON vs YAML formatting
 */
export const addInstructions = (options: {
  prop: string;
  mergeByContents?: boolean;
  mergeByProp?: string;
  mergeByName?: boolean;
  deepMerge?: boolean;
  comment?: string;
  removeComment?: boolean;
  commentBefore?: string;
  commentAfter?: string;
  flow?: boolean;  // YAML-specific: control flow (JSON) vs block (YAML) style
  flowItems?: boolean[];  // YAML-specific: control flow for individual array items
  hideNull?: boolean;  // YAML-specific: hide null values
  anchor?: string;  // YAML-specific: create an anchor on this property
  renameFrom?: string;  // YAML-specific: rename existing anchor globally
  alias?: string;  // YAML-specific: create an alias reference
  mergeAnchor?: string;  // YAML-specific: merge with an anchor
  anchors?: Record<number, string>;  // YAML-specific: anchors for array items
  aliases?: string[];  // YAML-specific: aliases for array items
}) => {
  // Call the original addInstructions with base properties
  const { flow, flowItems, hideNull, anchor, renameFrom, alias, mergeAnchor, anchors, aliases, ...baseOptions } = options;
  const result = addObjectInstructions(baseOptions);

  // If YAML-specific options are specified, add them to the result
  if (flow !== undefined || flowItems !== undefined || hideNull !== undefined || anchor !== undefined || renameFrom !== undefined || alias !== undefined || mergeAnchor !== undefined || anchors !== undefined || aliases !== undefined) {
    const symbolKey = Object.getOwnPropertySymbols(result).find(
      sym => sym.toString().includes(`merge_${options.prop}`)
    );
    if (symbolKey) {
      const instructions = result[symbolKey as any] as YAMLInstructions;
      if (flow !== undefined) {
        instructions.flow = flow;
      }
      if (flowItems !== undefined) {
        instructions.flowItems = flowItems;
      }
      if (hideNull !== undefined) {
        instructions.hideNull = hideNull;
      }
      if (anchor !== undefined) {
        instructions.anchor = anchor;
      }
      if (renameFrom !== undefined) {
        instructions.renameFrom = renameFrom;
      }
      if (alias !== undefined) {
        instructions.alias = alias;
      }
      if (mergeAnchor !== undefined) {
        instructions.mergeAnchor = mergeAnchor;
      }
      if (anchors !== undefined) {
        instructions.anchors = anchors;
      }
      if (aliases !== undefined) {
        instructions.aliases = aliases;
      }
    }
  }

  return result;
};

/**
 * Result of updateYaml operation including the YAML string, parsed objects, and comments
 */
export interface YamlEdit<T> {
  result: string;           // Updated YAML string
  resultParsed: T;          // Parsed updated object
  originalParsed: T;        // Original parsed object
  comments: {
    path: (string | number)[];
    comment: string;
  }[];
}

/**
 * Focused YAML updater - mimics focused-object-updater interface but works with YAML strings.
 * Internally uses @hiscojs/object-updater for object manipulation and applies changes to YAML AST.
 *
 * Type Safety:
 * - Generic T preserves the type of the parsed YAML object
 * - Generic L (inferred from findKey) represents the type at the selected path
 * - The findKey function uses TypeScript's type inference to track nested paths
 * - The merge function receives originalValue with the correct inferred type L
 * - Comments are tracked with their paths
 *
 * @example Basic YAML update
 * ```typescript
 * const yamlString = `
 * apiVersion: v1
 * kind: ConfigMap
 * data:
 *   database: localhost
 * `;
 *
 * const { result, comments } = updateYaml({
 *   yamlString,
 *   annotate: ({ change }) => {
 *     change({
 *       findKey: (parsed) => parsed.data,
 *       merge: () => ({
 *         database: 'db.production.com',
 *         cache: 'redis.production.com'
 *       }),
 *       comment: () => 'Updated to production endpoints'
 *     });
 *   }
 * });
 * ```
 *
 * @example With addInstructions for array merging
 * ```typescript
 * const { result } = updateYaml({
 *   yamlString: k8sDeployment,
 *   annotate: ({ change }) => {
 *     change({
 *       findKey: (parsed) => parsed.spec.template.spec.containers,
 *       merge: () => ({
 *         ...addInstructions({
 *           prop: 'containers',
 *           mergeByName: true
 *         }),
 *         containers: [
 *           {
 *             name: 'app',
 *             image: 'myapp:2.0'
 *           }
 *         ]
 *       }),
 *       comment: () => 'Updated container image'
 *     });
 *   }
 * });
 * ```
 */
export function updateYaml<T>({
  yamlString,
  selectDocument = () => 0,
  schema,
  annotate,
  defaultFlow = false
}: {
  yamlString: string;
  selectDocument?: (yamlDocuments: Document[]) => number;
  schema?: YAMLSchema;
  annotate?: (annotator: {
    change: <L>(options: {
      findKey: (parsed: T) => L;
      merge: (originalValue: L) => Partial<L> | undefined;
      comment?: (prev?: string) => string | undefined;
    }) => void;
  }) => void;
  defaultFlow?: boolean;  // Default flow style for all nodes (false = block style, true = flow style)
}): YamlEdit<T> {
  // Step 1: Parse YAML
  let yamlDocuments = parseAllDocuments(yamlString);

  // Handle empty YAML strings - create a new empty document
  if (yamlDocuments.length === 0 || !yamlDocuments[0] || yamlDocuments[0].toJSON() === null) {
    yamlDocuments = parseAllDocuments('{}');
  }

  const docIndex = selectDocument(yamlDocuments);

  // Ensure the selected document exists, create new documents if needed
  let originalYamlDocument = yamlDocuments[docIndex];
  if (!originalYamlDocument) {
    // Document at requested index doesn't exist, create empty documents up to that index
    // Build a multi-document YAML string with enough documents
    const docStrings: string[] = [];

    // Keep existing documents
    for (let i = 0; i < yamlDocuments.length; i++) {
      const docStr = yamlDocuments[i].toString({ lineWidth: 0 });
      // Remove leading --- if present
      const cleaned = docStr.startsWith('---\n') ? docStr.substring(4) : docStr;
      docStrings.push(cleaned.trim());
    }

    // Add new empty documents up to the requested index
    while (docStrings.length <= docIndex) {
      docStrings.push('{}');
    }

    // Re-parse the entire multi-document YAML
    const multiDocYaml = docStrings.map(s => '---\n' + s).join('\n');
    yamlDocuments = parseAllDocuments(multiDocYaml);

    originalYamlDocument = yamlDocuments[docIndex];
  }

  const originalParsed = originalYamlDocument.toJSON() as T;

  // Step 2: Use focused-object-updater to perform the object transformation
  // Also track instructions from addInstructions (comments, formatting, and anchors)
  const instructionsMap = new Map<string, YAMLInstructions>();

  // Track anchors and their YAML nodes
  const anchorMap = new Map<string, {
    path: (string | number)[];
    node?: Node;  // Will be set after diff application
  }>();

  // Detect existing anchors in source YAML
  detectExistingAnchors(originalYamlDocument, anchorMap);

  // Helper to extract schema instructions and add them to instructionsMap
  // These will be added first, so inline addInstructions can override them
  const extractSchemaInstructions = (
    schemaProps: Record<string, SchemaProperty> | undefined,
    basePath: (string | number)[] = []
  ) => {
    if (!schemaProps) return;

    Object.entries(schemaProps).forEach(([propName, schemaProp]) => {
      const fullPath = [...basePath, propName];
      const pathKey = JSON.stringify(fullPath);

      // Extract instructions for this property (excluding nested structure fields)
      const { properties, items, type, ...instructions } = schemaProp;

      // Only add if there are actual instructions
      if (Object.keys(instructions).length > 0) {
        instructionsMap.set(pathKey, instructions as YAMLInstructions);

        // Track anchors from schema
        if (instructions.anchor && !anchorMap.has(instructions.anchor) && !instructions.renameFrom) {
          anchorMap.set(instructions.anchor, {
            path: fullPath,
            node: undefined
          });
        }

        // Track array item anchors from schema
        if (instructions.anchors) {
          Object.entries(instructions.anchors).forEach(([indexStr, anchorName]) => {
            const index = parseInt(indexStr, 10);
            anchorMap.set(anchorName, {
              path: [...fullPath, index],
              node: undefined
            });
          });
        }
      }

      // Process nested properties
      if (properties) {
        extractSchemaInstructions(properties, fullPath);
      }

      // Process array items
      if (items && Array.isArray(items)) {
        items.forEach((itemSchema, index) => {
          const itemPath = [...fullPath, index];
          const itemPathKey = JSON.stringify(itemPath);

          // Extract instructions for array item
          const { properties: itemProps, items: nestedItems, type: itemType, ...itemInstructions } = itemSchema;

          if (Object.keys(itemInstructions).length > 0) {
            instructionsMap.set(itemPathKey, itemInstructions as YAMLInstructions);

            // Track anchors for array items
            if (itemInstructions.anchor && !anchorMap.has(itemInstructions.anchor) && !itemInstructions.renameFrom) {
              anchorMap.set(itemInstructions.anchor, {
                path: itemPath,
                node: undefined
              });
            }
          }

          // Recursively process nested properties in array items
          if (itemProps) {
            extractSchemaInstructions(itemProps, itemPath);
          }
        });
      }
    });
  };

  // Extract schema instructions first (lower priority)
  if (schema?.properties) {
    extractSchemaInstructions(schema.properties);
  }

  // Helper to recursively extract YAML instructions from merge result
  // These will override schema instructions due to processing order
  const extractYAMLInstructions = (obj: unknown, basePath: (string | number)[], visited: WeakSet<object> = new WeakSet()) => {
    if (!obj || typeof obj !== 'object' || visited.has(obj)) {
      return;
    }
    visited.add(obj);

    // Extract symbols first
    const objWithSymbols = obj as Record<symbol, unknown>;
    const symbols = Object.getOwnPropertySymbols(objWithSymbols);
    for (const sym of symbols) {
      const symKey = sym.toString();
      const propMatch = symKey.match(/Symbol\(merge_(.+)\)/);
      if (propMatch) {
        const prop = propMatch[1];
        const instructions = objWithSymbols[sym] as YAMLInstructions | undefined;
        const fullPath = [...basePath, prop];

        if (instructions && (instructions.comment || instructions.removeComment || instructions.commentBefore || instructions.commentAfter || instructions.flow !== undefined || instructions.flowItems !== undefined || instructions.hideNull || instructions.anchor || instructions.alias || instructions.mergeAnchor || instructions.anchors || instructions.aliases || instructions.mergeByName || instructions.mergeByProp || instructions.mergeByContents || instructions.deepMerge)) {
          instructionsMap.set(JSON.stringify(fullPath), instructions);

          // If this has an anchor definition, track it
          // Don't overwrite existing anchors from source YAML
          // Skip if this is part of a rename operation (renameFrom handles it)
          if (instructions.anchor && !anchorMap.has(instructions.anchor) && !instructions.renameFrom) {
            anchorMap.set(instructions.anchor, {
              path: fullPath,
              node: undefined  // Will be set after diff application
            });
          }

          // If this has array item anchors, track them
          if (instructions.anchors) {
            Object.entries(instructions.anchors).forEach(([indexStr, anchorName]) => {
              const index = parseInt(indexStr, 10);
              anchorMap.set(anchorName, {
                path: [...fullPath, index],
                node: undefined
              });
            });
          }
        }
      }
    }

    // Recursively process nested objects and arrays
    const objAsRecord = obj as Record<string, unknown>;
    const keys = Object.keys(objAsRecord);
    for (const key of keys) {
      const value = objAsRecord[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          // Process array items
          value.forEach((item, index) => {
            if (item && typeof item === 'object') {
              extractYAMLInstructions(item, [...basePath, key, index], visited);
            }
          });
        } else {
          // Process nested object
          extractYAMLInstructions(value, [...basePath, key], visited);
        }
      }
    }
  };

  const { result: updatedObject, comments: objectComments } = updateObject({
    sourceObject: originalParsed,
    annotate: annotate ? (objectAnnotator) => {
      annotate({
        change: (options) => {
          // Calculate base path ONCE before any merge operations
          const basePath = findKeyByProxy(originalParsed as T, options.findKey);

          // Cache the merge result to avoid calling options.merge() twice
          let mergeResultCache: unknown = null;
          let mergeCalled = false;

          const cachedMerge = (originalValue: unknown): unknown => {
            if (!mergeCalled) {
              // We need to cast here because the generic type system is complex
              const typedMerge = options.merge as (val: unknown) => unknown;
              const result = typedMerge(originalValue);

              // If merge returns undefined, use the original value
              mergeResultCache = result !== undefined ? result : originalValue;
              mergeCalled = true;

              // Extract comment instructions from the cached result
              extractYAMLInstructions(mergeResultCache, basePath);
            }
            return mergeResultCache;
          };

          objectAnnotator.change({
            findKey: options.findKey,
            merge: cachedMerge as any,
            comment: options.comment ? (prev) => {
              const commentText = options.comment!(prev);
              if (commentText) {
                return {
                  text: commentText,
                  direction: 'right' as const // YAML comments don't have direction, but we need this for the interface
                };
              }
              return undefined;
            } : undefined
          });
        }
      });
    } : undefined
  });

  // Step 3: Calculate diff between original and updated objects
  const diff = deepDiff(originalParsed, updatedObject) as DiffType[] | undefined;


  // Reverse array diff sequences (same logic as yaml-editor)
  const locatedArrayIndex: number[] = [];
  if (diff != undefined) {
    diff.forEach((d, index) => {
      if (d.kind === 'A') {
        locatedArrayIndex.push(index);
      }
    });
  }
  const reversedArrayIndex = reverseArrayDiffSequences(locatedArrayIndex);
  const clonedDiff: DiffType[] = [...(diff == undefined ? [] : diff)];
  locatedArrayIndex.forEach((index, i) => {
    if (diff) {
      clonedDiff[index] = diff[reversedArrayIndex[i]];
    }
  });

  // Step 4: Apply diff to YAML AST
  // Track which array paths have been processed to avoid duplicates
  const processedArrayPaths = new Set<string>();

  // Sort diffs to ensure 'E' (edits) are processed before 'A' (array additions)
  // This prevents issues where array replacements invalidate edit paths
  const sortedDiff = clonedDiff.sort((a, b) => {
    if (a.kind === 'E' && b.kind === 'A') return -1;
    if (a.kind === 'A' && b.kind === 'E') return 1;
    return 0;
  });

  sortedDiff.forEach((df) => {
    if (df.kind === 'N' && df.path) {
      // New property
      changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
      const diffNew = df as DiffNew;

      // Check if there are flow instructions for this path
      const pathKey = JSON.stringify(df.path);
      const instructions = instructionsMap.get(pathKey);
      const flowStyle = instructions?.flow !== undefined ? instructions.flow : defaultFlow;

      originalYamlDocument.setIn(
        df.path,
        originalYamlDocument.createNode(diffNew.rhs, { flow: flowStyle }),
      );
    } else if (df.kind === 'D' && df.path) {
      // Deleted property
      originalYamlDocument.deleteIn(df.path);
    } else if (df.kind === 'E' && df.path) {
      // Edited property
      changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
      const diffEdit = df as DiffEdit;

      // Check if there are flow instructions for this path
      const pathKey = JSON.stringify(df.path);
      const instructions = instructionsMap.get(pathKey);
      const flowStyle = instructions?.flow !== undefined ? instructions.flow : defaultFlow;

      originalYamlDocument.setIn(df.path, originalYamlDocument.createNode(diffEdit.rhs, { flow: flowStyle }));
    } else if (df.kind === 'A' && df.path) {
      // Array change - handle array updates specially
      const arrayPath = JSON.stringify(df.path);

      // If we have multiple A diffs for the same array path,
      // check if we need to handle a complete array replacement
      const arrayDiffs = clonedDiff.filter(
        d => d.kind === 'A' && d.path && JSON.stringify(d.path) === arrayPath
      );

      if (arrayDiffs.length > 0 && !processedArrayPaths.has(arrayPath) && df.path) {
        processedArrayPaths.add(arrayPath);

        // Helper to get value at path from an object
        const getValueAtPath = (obj: unknown, path: (string | number)[]): unknown => {
          let current = obj;
          for (const key of path) {
            if (current && typeof current === 'object') {
              current = (current as Record<string | number, unknown>)[key];
            } else {
              return undefined;
            }
          }
          return current;
        };

        // Get the original and updated arrays to compare
        const originalArray = getValueAtPath(originalParsed, df.path);
        const updatedArray = getValueAtPath(updatedObject, df.path);

        // Check if there are merge instructions for this array
        const pathKey = JSON.stringify(df.path);
        const instructions = instructionsMap.get(pathKey);
        const hasMergeInstructions = instructions && (
          instructions.mergeByName ||
          instructions.mergeByProp ||
          instructions.mergeByContents ||
          instructions.deepMerge
        );

        // If there are NO merge instructions, do a complete array replacement
        // NOTE: This doesn't fully work because object-updater merges arrays by default
        // See OBJECT_UPDATER_BUG.md for details
        if (!hasMergeInstructions && Array.isArray(updatedArray) && df.path) {
          changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
          const flowStyle = instructions?.flow !== undefined ? instructions.flow : defaultFlow;
          originalYamlDocument.setIn(df.path, originalYamlDocument.createNode(updatedArray, { flow: flowStyle }));
          return;
        }

        // Check if there are any 'E' diffs for elements in this array
        // If so, we need to be careful about array replacement
        const hasElementEdits = sortedDiff.some(
          d => d.kind === 'E' &&
          d.path &&
          df.path &&
          d.path.length > df.path.length &&
          d.path.slice(0, df.path.length).every((p, i) => p === df.path![i])
        );

        // Check if we're only adding items (no modifications to existing ones)
        const originalLength = Array.isArray(originalArray) ? originalArray.length : 0;
        const allAddsAreNew = arrayDiffs.every((d) => (d as DiffArray).index >= originalLength);

        // Check if all diffs are deletions
        const allAreDeletes = arrayDiffs.every((d) => (d as DiffArray).item.kind === 'D');

        if (allAreDeletes) {
          // All items being deleted - replace with the updated array (likely empty or shorter)
          if (Array.isArray(updatedArray) && df.path) {
            changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));

            // Check if there are flow instructions for this path
            const pathKey = JSON.stringify(df.path);
            const instructions = instructionsMap.get(pathKey);
            const flowStyle = instructions?.flow !== undefined ? instructions.flow : defaultFlow;

            originalYamlDocument.setIn(df.path, originalYamlDocument.createNode(updatedArray, { flow: flowStyle }));
          }
          return;
        }

        if (hasElementEdits || allAddsAreNew) {
          // Either we have element edits, or we're only adding new items
          // In both cases, preserve existing elements and only add truly new items

          arrayDiffs.forEach((aDiff) => {
            const arrayDiff = aDiff as DiffArray;
            // Only add items that are truly new (index >= original length)
            // AND not duplicates of existing items
            if (arrayDiff.index >= originalLength && df.path && arrayDiff.item.rhs !== undefined) {
              const newItem = arrayDiff.item.rhs;
              const origArray = originalArray as unknown[] | undefined;
              const isDuplicate = origArray && origArray.some(
                (orig) => JSON.stringify(orig) === JSON.stringify(newItem)
              );

              if (!isDuplicate) {
                changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
                originalYamlDocument.addIn(
                  df.path,
                  originalYamlDocument.createNode(newItem, { flow: defaultFlow }),
                );
              }
            }
          });
          return;
        }

        // Check if this looks like a complete array replacement
        // This happens when deep-diff generates weird indices
        const firstDiffIndex = Math.min(...arrayDiffs.map((d) => (d as DiffArray).index));


        if (firstDiffIndex >= originalLength && Array.isArray(updatedArray)) {
          // This is likely a complete replacement
          // But we need to check if the array was incorrectly duplicated by object-updater
          let correctedArray = updatedArray;

          // Check if the array seems to be duplicated
          // This happens when object-updater incorrectly handles [...arr, newItem]
          if (originalLength > 0 && updatedArray.length === arrayDiffs.length + originalLength) {
            // Check if the first part matches the original array
            const firstPart = updatedArray.slice(0, originalLength);
            const arraysMatch = JSON.stringify(firstPart) === JSON.stringify(originalArray);

            if (arraysMatch) {
              // The array was duplicated - just use the unique new items
              const uniqueNewItems = new Set<unknown>();
              arrayDiffs.forEach((d) => {
                const diffArray = d as DiffArray;
                if (diffArray.item.rhs !== undefined) {
                  uniqueNewItems.add(diffArray.item.rhs);
                }
              });

              // Find what items are truly new (not in original)
              const newItems: unknown[] = [];
              const origArray = originalArray as unknown[];
              updatedArray.forEach((item) => {
                const itemStr = JSON.stringify(item);
                const isInOriginal = origArray.some((orig) => JSON.stringify(orig) === itemStr);
                if (!isInOriginal) {
                  newItems.push(item);
                }
              });

              // Reconstruct the correct array
              correctedArray = [...origArray, ...newItems];
            }
          }

          changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));

          // Check if there are flow instructions for this path
          const pathKey = JSON.stringify(df.path);
          const instructions = instructionsMap.get(pathKey);
          const flowStyle = instructions?.flow !== undefined ? instructions.flow : defaultFlow;

          originalYamlDocument.setIn(df.path, originalYamlDocument.createNode(correctedArray, { flow: flowStyle }));
        } else {
          // Normal array additions - add only truly new items
          arrayDiffs.forEach((aDiff) => {
            const arrayDiff = aDiff as DiffArray;
            if (arrayDiff.index >= originalLength && df.path && arrayDiff.item.rhs !== undefined) {
              changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
              originalYamlDocument.addIn(
                df.path,
                originalYamlDocument.createNode(arrayDiff.item.rhs, { flow: defaultFlow }),
              );
            }
          });
        }
      }
    }
  });

  // Step 5: Apply comments to YAML nodes
  const comments: { path: (string | number)[]; comment: string }[] = [];

  // First apply comments from the change() comment callback
  objectComments.forEach(({ path, comment: commentText, direction }) => {
    const node = originalYamlDocument.getIn(path, true);
    if (node) {
      const yamlNode = node as YAMLNodeWithComment;

      // Check if this is an inline comment (direction = 'right')
      if (direction === 'right') {
        // Apply inline comment to the value node
        (yamlNode as any).comment = ' ' + commentText;

        // If the value is null and we're adding an inline comment,
        // set source to empty string so it renders as "key: # comment" not "key: null # comment"
        // Note: type might be undefined for created nodes, so we check value === null instead
        if ((yamlNode as any).value === null) {
          (yamlNode as any).type = 'PLAIN';
          (yamlNode as any).source = '';
        }
      } else {
        // Default: apply comment before (block comment above the key)
        yamlNode.commentBefore = ' ' + commentText;

        // If we're adding a comment to an empty object/array, ensure it's not in flow style
        if (commentText && yamlNode.type === 'MAP' && yamlNode.items && Array.isArray(yamlNode.items) && yamlNode.items.length === 0) {
          yamlNode.flow = false;
        }
      }

      comments.push({
        path,
        comment: commentText
      });
    }
  });

  // Step 5.5: Apply anchor and alias instructions FIRST (before comments/flow)
  // This ensures all node structures are finalized before we try to apply comments
  // First, validate all anchor names
  instructionsMap.forEach((instructions, pathKey) => {
    if (instructions.anchor) {
      validateAnchorName(instructions.anchor);
    }
    if (instructions.alias) {
      validateAnchorName(instructions.alias);
    }
    if (instructions.mergeAnchor) {
      validateAnchorName(instructions.mergeAnchor);
    }
    if (instructions.anchors) {
      Object.values(instructions.anchors).forEach(anchorName => {
        validateAnchorName(anchorName);
      });
    }
    if (instructions.aliases) {
      instructions.aliases.forEach(anchorName => {
        validateAnchorName(anchorName);
      });
    }
  });

  // Detect circular references
  detectCircularReferences(instructionsMap, anchorMap);

  // Process anchor renames BEFORE applying new anchors
  // This is a global operation that updates all references in the document
  instructionsMap.forEach((instructions, pathKey) => {
    if (instructions.renameFrom && instructions.anchor) {
      renameAnchorGlobally(
        originalYamlDocument,
        instructions.renameFrom,
        instructions.anchor,
        anchorMap
      );
    }
  });

  // Apply anchors to nodes
  instructionsMap.forEach((instructions, pathKey) => {
    const path = JSON.parse(pathKey) as (string | number)[];

    // Apply anchor to the value node
    if (instructions.anchor) {
      const node = originalYamlDocument.getIn(path, true);
      if (node && typeof node === 'object') {
        (node as any).anchor = instructions.anchor;
        // Update anchor map with the actual node
        anchorMap.set(instructions.anchor, {
          path,
          node: node as Node
        });
      }
    }

    // Apply anchors to array items
    if (instructions.anchors) {
      const arrayNode = originalYamlDocument.getIn(path, true);
      if (arrayNode && typeof arrayNode === 'object' && 'items' in arrayNode && Array.isArray((arrayNode as any).items)) {
        Object.entries(instructions.anchors).forEach(([indexStr, anchorName]) => {
          const index = parseInt(indexStr, 10);
          const items = (arrayNode as any).items;
          if (index < items.length && items[index]) {
            items[index].anchor = anchorName;
            // Update anchor map with the actual node
            anchorMap.set(anchorName, {
              path: [...path, index],
              node: items[index]
            });
          }
        });
      }
    }
  });

  // Apply alias references
  instructionsMap.forEach((instructions, pathKey) => {
    const path = JSON.parse(pathKey) as (string | number)[];

    // Apply simple alias reference
    if (instructions.alias) {
      const anchorInfo = anchorMap.get(instructions.alias);
      if (!anchorInfo) {
        throw new Error(
          `Anchor '${instructions.alias}' is not defined. ` +
          `Make sure to create the anchor with addInstructions({ anchor: '${instructions.alias}' }) before referencing it.`
        );
      }

      // Get the current node reference (in case it changed after diff application)
      let anchorNode = anchorInfo.node;
      if (!anchorNode && anchorInfo.path) {
        anchorNode = originalYamlDocument.getIn(anchorInfo.path, true) as Node;
      }

      if (!anchorNode) {
        throw new Error(
          `Anchor '${instructions.alias}' node could not be found in the document.`
        );
      }

      // Create an alias node - cast to any to bypass TypeScript type restrictions
      const aliasNode = originalYamlDocument.createAlias(anchorNode as any, instructions.alias);
      originalYamlDocument.setIn(path, aliasNode);
    }

    // Apply merge anchor reference
    if (instructions.mergeAnchor) {
      const anchorInfo = anchorMap.get(instructions.mergeAnchor);
      if (!anchorInfo) {
        throw new Error(
          `Anchor '${instructions.mergeAnchor}' is not defined. ` +
          `Make sure to create the anchor with addInstructions({ anchor: '${instructions.mergeAnchor}' }) before referencing it.`
        );
      }

      // Get the current node reference (in case it changed after diff application)
      let anchorNode = anchorInfo.node;
      if (!anchorNode && anchorInfo.path) {
        anchorNode = originalYamlDocument.getIn(anchorInfo.path, true) as Node;
      }

      if (!anchorNode) {
        throw new Error(
          `Anchor '${instructions.mergeAnchor}' node could not be found in the document.`
        );
      }

      const node = originalYamlDocument.getIn(path, true);
      if (node && typeof node === 'object' && 'items' in node && Array.isArray((node as any).items)) {
        const mapNode = node as YAMLMap;

        // Create merge key with alias - cast to any to bypass TypeScript type restrictions
        const mergeKey = originalYamlDocument.createPair(
          '<<',
          originalYamlDocument.createAlias(anchorNode as any, instructions.mergeAnchor)
        );

        // Insert as first item in the map
        mapNode.items.unshift(mergeKey as any);
      }
    }

    // Apply array item aliases
    if (instructions.aliases) {
      const arrayNode = originalYamlDocument.getIn(path, true);
      if (arrayNode && typeof arrayNode === 'object' && 'items' in arrayNode && Array.isArray((arrayNode as any).items)) {
        instructions.aliases.forEach((anchorName, index) => {
          const anchorInfo = anchorMap.get(anchorName);
          if (!anchorInfo) {
            throw new Error(
              `Anchor '${anchorName}' is not defined. ` +
              `Make sure to create the anchor with addInstructions({ anchor: '${anchorName}' }) before referencing it.`
            );
          }

          // Get the current node reference (in case it changed after diff application)
          let anchorNode = anchorInfo.node;
          if (!anchorNode && anchorInfo.path) {
            anchorNode = originalYamlDocument.getIn(anchorInfo.path, true) as Node;
          }

          if (!anchorNode) {
            throw new Error(
              `Anchor '${anchorName}' node could not be found in the document.`
            );
          }

          const items = (arrayNode as any).items;
          if (index < items.length) {
            // Replace array item with alias - cast to any to bypass TypeScript type restrictions
            const aliasNode = originalYamlDocument.createAlias(anchorNode as any, anchorName);
            items[index] = aliasNode;
          }
        });
      }
    }
  });

  // Step 5.6: Apply comments and flow styles AFTER anchors are set
  // This ensures Pair structures are finalized and we can find them correctly
  instructionsMap.forEach((instructions, pathKey) => {
    const path = JSON.parse(pathKey) as (string | number)[];

    // Get the value node (for flow style formatting)
    const valueNode = originalYamlDocument.getIn(path, true) as YAMLNodeWithComment;

    // For comments: To add a comment ABOVE a property, we need to set commentBefore on the Pair's key
    // not on the value itself. So we need to find the Pair in the parent.
    let commentTargetNode: YAMLNodeWithComment | null = null;

    if (path.length === 0) {
      // Root level - comment on the document itself
      commentTargetNode = originalYamlDocument.getIn(path, true) as YAMLNodeWithComment;
    } else {
      // Get the parent and find the Pair object
      const parentPath = path.slice(0, -1);
      const propKey = path[path.length - 1];
      const parent = parentPath.length === 0
        ? originalYamlDocument.contents
        : originalYamlDocument.getIn(parentPath, true);

      if (parent && typeof parent === 'object' && 'items' in parent && Array.isArray(parent.items)) {
        // Parent is a YAMLMap, find the Pair with matching key
        const pair = parent.items.find((item: any) => {
          if (!item || typeof item !== 'object' || !('key' in item)) {
            return false;
          }

          // The key can be either a Scalar node with a value property, or a direct string/number
          const keyNode = item.key;
          if (!keyNode) {
            return false;
          }

          // Check if key has a value property (it's a Scalar node)
          if (typeof keyNode === 'object' && 'value' in keyNode) {
            return keyNode.value === propKey;
          }

          // Otherwise compare directly
          return keyNode === propKey;
        });

        if (pair && typeof pair === 'object' && 'key' in pair) {
          // Set comment on the Pair's key, which will appear above the key:value line
          // If the key is a primitive, convert it to a Scalar node so we can add comments
          if (pair.key && typeof pair.key !== 'object') {
            pair.key = new Scalar(pair.key);
          }

          // Now the key should be an object
          if (pair.key && typeof pair.key === 'object') {
            commentTargetNode = pair.key as YAMLNodeWithComment;
          }
        }
      }
    }

    // Apply comment instructions
    if (instructions.comment || instructions.removeComment || instructions.commentBefore || instructions.commentAfter) {
      // If we couldn't find the Pair's key as an object, try setting comment on the value node
      // This is a fallback for newly created properties where the key is a simple string
      if (!commentTargetNode && valueNode) {
        commentTargetNode = valueNode;
      }

      if (commentTargetNode) {
        if (instructions.removeComment) {
          // Remove existing comment
          commentTargetNode.commentBefore = undefined;
        } else if (instructions.comment) {
          // Add or replace comment
          commentTargetNode.commentBefore = ' ' + instructions.comment;

          comments.push({
            path,
            comment: instructions.comment
          });
        } else if (instructions.commentBefore) {
          // Add comment before (same as comment in YAML)
          commentTargetNode.commentBefore = ' ' + instructions.commentBefore;

          comments.push({
            path,
            comment: instructions.commentBefore
          });
        }
      }
    }

    // Apply inline comment (commentAfter) to value node
    if (instructions.commentAfter && valueNode) {
      (valueNode as any).comment = ' ' + instructions.commentAfter;

      // If the value is null and we're adding an inline comment,
      // set source to empty string so it renders as "key: # comment" not "key: null # comment"
      // IMPORTANT: Set source AFTER setting comment, as the YAML library won't regenerate it
      // Note: type might be undefined for created nodes, so we check value === null instead
      if ((valueNode as any).value === null) {
        (valueNode as any).type = 'PLAIN';
        (valueNode as any).source = '';
      }

      comments.push({
        path,
        comment: instructions.commentAfter
      });
    }

    // Apply hideNull instruction
    if (valueNode && instructions.hideNull && (valueNode as any).value === null) {
      (valueNode as any).type = 'PLAIN';
      (valueNode as any).source = '';
    }

    // Apply flow style instructions
    if (valueNode && instructions.flow !== undefined) {
      valueNode.flow = instructions.flow;
    }

    // Apply flow style to individual array items
    if (valueNode && instructions.flowItems !== undefined && 'items' in valueNode && Array.isArray(valueNode.items)) {
      // When flowItems is specified, the array itself should be in block style
      valueNode.flow = false;

      const items = valueNode.items as any[];
      instructions.flowItems.forEach((flowValue, index) => {
        if (index < items.length && items[index]) {
          items[index].flow = flowValue;
        }
      });
    }
  });

  // Step 6: Stringify YAML
  // If we have multiple documents, combine them all back together
  let result: string;
  if (yamlDocuments.length > 1) {
    // Combine all documents back together
    const docStrings = yamlDocuments.map(doc => {
      const str = doc.toString({ lineWidth: 0 });
      // Remove leading --- if present (we'll add it consistently)
      return str.startsWith('---\n') ? str.substring(4) : str;
    });

    // Join with proper document separators
    result = docStrings.map((str, index) => {
      // Add --- before each document
      return '---\n' + str.trim();
    }).join('\n');
  } else {
    // Single document - just use the updated document
    result = originalYamlDocument.toString({ lineWidth: 0 });
  }

  // Fix resultParsed if arrays were incorrectly duplicated
  const fixedResult = yamlDocuments[docIndex].toJSON() as T;

  return {
    result,
    resultParsed: fixedResult,
    originalParsed,
    comments
  };
}

/**
 * Select the first document from a multi-document YAML
 * This is a convenience function that always returns 0
 * @param yamlDocuments Array of YAML documents (not used, but kept for consistency)
 * @returns Always returns 0 to select the first document
 */
export function selectFirstDocument(yamlDocuments: Document[]): number {
  return 0;
}

/**
 * Validate anchor name according to YAML spec
 * Anchor names must contain only alphanumeric characters, underscores, and hyphens
 */
function validateAnchorName(anchorName: string): void {
  const validAnchorRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validAnchorRegex.test(anchorName)) {
    throw new Error(
      `Invalid anchor name '${anchorName}'. ` +
      `Anchor names must match [a-zA-Z0-9_-]+ (alphanumeric, underscore, and hyphen only).`
    );
  }
}

/**
 * Detect circular anchor references
 * Throws an error if a circular reference is detected
 */
function detectCircularReferences(
  instructionsMap: Map<string, YAMLInstructions>,
  anchorMap: Map<string, { path: (string | number)[]; node?: Node }>
): void {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function visit(anchorName: string, path: string[] = []): void {
    if (recursionStack.has(anchorName)) {
      throw new Error(
        `Circular anchor reference detected: ${[...path, anchorName].join(' -> ')}`
      );
    }

    if (visited.has(anchorName)) {
      return;
    }

    visited.add(anchorName);
    recursionStack.add(anchorName);

    // Find if this anchor has a mergeAnchor instruction
    const anchorInfo = anchorMap.get(anchorName);
    if (anchorInfo) {
      const pathKey = JSON.stringify(anchorInfo.path);
      const instructions = instructionsMap.get(pathKey);
      if (instructions?.mergeAnchor) {
        visit(instructions.mergeAnchor, [...path, anchorName]);
      }
    }

    recursionStack.delete(anchorName);
  }

  for (const anchorName of anchorMap.keys()) {
    visit(anchorName);
  }
}

/**
 * Detect existing anchors in the source YAML document
 */
function detectExistingAnchors(
  doc: Document,
  anchorMap: Map<string, { path: (string | number)[]; node?: Node }>
): void {
  function visitNode(node: unknown, path: (string | number)[] = []): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    const yamlNode = node as any;

    // Check if this node has an anchor
    if (yamlNode.anchor && typeof yamlNode.anchor === 'string') {
      const anchorName = yamlNode.anchor;
      // Always add anchors from source, even if they'll be overwritten later
      anchorMap.set(anchorName, {
        path,
        node: yamlNode as Node
      });
    }

    // Recursively visit children
    // Check for MAP (has items array with key-value pairs)
    if ('items' in yamlNode && Array.isArray(yamlNode.items)) {
      // Could be MAP or SEQ, check if items have 'key' property
      if (yamlNode.items.length > 0 && yamlNode.items[0] && 'key' in yamlNode.items[0]) {
        // It's a MAP
        yamlNode.items.forEach((pair: any) => {
          if (pair && typeof pair === 'object' && pair.key && pair.value) {
            // Get the key value
            let key: string | number;
            if (typeof pair.key === 'object' && 'value' in pair.key) {
              key = pair.key.value;
            } else {
              key = pair.key;
            }

            // Visit the value node
            visitNode(pair.value, [...path, key]);
          }
        });
      } else {
        // It's a SEQ
        yamlNode.items.forEach((item: any, index: number) => {
          visitNode(item, [...path, index]);
        });
      }
    }
  }

  if (doc.contents) {
    visitNode(doc.contents);
  }
}

/**
 * Rename an anchor globally throughout the entire document
 * Updates the anchor definition and all references (simple aliases and merge keys)
 */
function renameAnchorGlobally(
  doc: Document,
  fromName: string,
  toName: string,
  anchorMap: Map<string, { path: (string | number)[]; node?: Node }>
): void {
  // 1. Validate the new anchor name
  validateAnchorName(toName);

  // 2. Check if source anchor exists
  const anchorInfo = anchorMap.get(fromName);
  if (!anchorInfo) {
    // Source anchor doesn't exist - this is a no-op, will just create new anchor later
    return;
  }

  // 3. Check if target anchor name already exists (collision)
  if (anchorMap.has(toName)) {
    throw new Error(
      `Anchor '${toName}' already exists. Cannot rename '${fromName}' to '${toName}'.`
    );
  }

  // 4. Update the anchor definition on the source node
  if (anchorInfo.node && typeof anchorInfo.node === 'object') {
    (anchorInfo.node as any).anchor = toName;
  }

  // 5. Walk the entire document and update ALL references
  function visitAndRenameReferences(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    const yamlNode = node as any;

    // Check if this is an Alias node that references the old anchor
    if ('source' in yamlNode && yamlNode.source === fromName) {
      yamlNode.source = toName;
    }

    // Recursively visit children
    if ('items' in yamlNode && Array.isArray(yamlNode.items)) {
      // Could be MAP or SEQ
      if (yamlNode.items.length > 0 && yamlNode.items[0] && 'key' in yamlNode.items[0]) {
        // It's a MAP - visit both keys and values
        yamlNode.items.forEach((pair: any) => {
          if (pair && typeof pair === 'object') {
            if (pair.key) visitAndRenameReferences(pair.key);
            if (pair.value) visitAndRenameReferences(pair.value);
          }
        });
      } else {
        // It's a SEQ - visit all items
        yamlNode.items.forEach((item: any) => {
          visitAndRenameReferences(item);
        });
      }
    }
  }

  if (doc.contents) {
    visitAndRenameReferences(doc.contents);
  }

  // 6. Update the anchor map
  anchorMap.delete(fromName);
  anchorMap.set(toName, {
    ...anchorInfo,
    node: anchorInfo.node
  });
}

/**
 * Helper function to reverse array diff sequences
 * (copied from yaml-editor.ts)
 */
function reverseArrayDiffSequences(array: number[]): number[] {
  const result: number[] = [];
  let start = 0;

  for (let i = 1; i < array.length; i++) {
    if (array[i] !== array[i - 1] + 1) {
      result.push(...array.slice(start, i).reverse());
      start = i;
    }
  }

  result.push(...array.slice(start).reverse());

  return result;
}

/**
 * Helper function to change specific nodes to non-flow style
 * (copied from yaml-editor.ts)
 */
function changeSpecificNodesToNoneFlow(originalYamlDocument: Document, path: (string | number)[]) {
  const node = originalYamlDocument.getIn(path, true);
  if (!node) {
    return;
  }

  const yamlNode = node as YAMLNodeWithComment & {
    content?: string | null;
    items?: unknown[] | Map<unknown, unknown>;
  };

  const isEmptyObject = yamlNode.items && Array.isArray(yamlNode.items) && yamlNode.items.length === 0;
  const isEmptyArray = yamlNode.items && yamlNode.items instanceof Map && yamlNode.items.size === 0;

  if (yamlNode.flow === true &&
      (yamlNode.content === '{}' ||
       yamlNode.content === '[]' ||
       yamlNode.content === null ||
       yamlNode.content === undefined ||
       isEmptyObject ||
       isEmptyArray)) {
    yamlNode.flow = false;
  }

  if (yamlNode.type === 'MAP' && yamlNode.items && Array.isArray(yamlNode.items) && yamlNode.items.length === 0 && yamlNode.commentBefore) {
    yamlNode.flow = false;
  }
}
