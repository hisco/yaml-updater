import { diff as deepDiff } from 'deep-diff';
import { Document, parseAllDocuments } from 'yaml';
import { updateObject, addInstructions as addObjectInstructions, CommentInstructions, findKeyByProxy } from '@hiscojs/object-updater';

/**
 * Re-export addInstructions for convenience
 */
export const addInstructions = addObjectInstructions;

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
export function updateYaml<T extends object = object>({
  yamlString,
  selectDocument = () => 0,
  annotate
}: {
  yamlString: string;
  selectDocument?: (yamlDocuments: Document[]) => number;
  annotate?: (annotator: {
    change: <L>(options: {
      findKey: (parsed: T) => L;
      merge: (originalValue: L) => L extends any[]
        ? unknown[]
        : L extends object
          ? { [K in keyof L]?: L[K] } & { [key: string]: unknown }
          : L;
      comment?: (prev?: string) => string | undefined;
    }) => void;
  }) => void;
}): YamlEdit<T> {
  // Step 1: Parse YAML
  const yamlDocuments = parseAllDocuments(yamlString);
  const docIndex = selectDocument(yamlDocuments);
  const originalYamlDocument = yamlDocuments[docIndex];
  const originalParsed = originalYamlDocument.toJSON() as T;

  // Step 2: Use focused-object-updater to perform the object transformation
  // Also track comment instructions from addInstructions
  const commentInstructionsMap = new Map<string, CommentInstructions>();

  // Helper to recursively extract comment instructions from merge result
  const extractCommentInstructions = (obj: any, basePath: (string | number)[], visited: WeakSet<object> = new WeakSet()) => {
    if (!obj || typeof obj !== 'object' || visited.has(obj)) {
      return;
    }
    visited.add(obj);

    // Extract symbols first
    const symbols = Object.getOwnPropertySymbols(obj);
    for (const sym of symbols) {
      const symKey = sym.toString();
      const propMatch = symKey.match(/Symbol\(merge_(.+)\)/);
      if (propMatch) {
        const prop = propMatch[1];
        const instructions = obj[sym];
        const fullPath = [...basePath, prop];

        if (instructions && (instructions.comment || instructions.removeComment || instructions.commentBefore || instructions.commentAfter)) {
          commentInstructionsMap.set(JSON.stringify(fullPath), instructions);
        }
      }
    }

    // Recursively process nested objects (not arrays)
    const keys = Object.keys(obj);
    for (const key of keys) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        extractCommentInstructions(value, [...basePath, key], visited);
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
          let mergeResultCache: any = null;
          let mergeCalled = false;

          const cachedMerge = (originalValue: any) => {
            if (!mergeCalled) {
              mergeResultCache = options.merge(originalValue);
              mergeCalled = true;

              // Extract comment instructions from the cached result
              extractCommentInstructions(mergeResultCache, basePath);
            }
            return mergeResultCache;
          };

          objectAnnotator.change({
            findKey: options.findKey,
            merge: cachedMerge,
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
  const diff = deepDiff(originalParsed, updatedObject);

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
  const clonedDiff = [...(diff == undefined ? [] : diff)];
  locatedArrayIndex.forEach((index, i) => {
    if (diff) {
      clonedDiff[index] = diff[reversedArrayIndex[i]];
    }
  });

  // Step 4: Apply diff to YAML AST
  clonedDiff.forEach((df) => {
    if (df.kind === 'N' && df.path) {
      // New property
      changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
      originalYamlDocument.setIn(
        df.path,
        originalYamlDocument.createNode((df as any).rhs, { flow: false }),
      );
    } else if (df.kind === 'D' && df.path) {
      // Deleted property
      originalYamlDocument.deleteIn(df.path);
    } else if (df.kind === 'E' && df.path) {
      // Edited property
      changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
      originalYamlDocument.setIn(df.path, (df as any).rhs);
    } else if (df.kind === 'A' && df.path) {
      // Array change
      changeSpecificNodesToNoneFlow(originalYamlDocument, df.path.slice(0, -1));
      originalYamlDocument.addIn(
        df.path,
        originalYamlDocument.createNode((df as any).item.rhs, { flow: false }),
      );
    }
  });

  // Step 5: Apply comments to YAML nodes
  const comments: { path: (string | number)[]; comment: string }[] = [];

  // First apply comments from the change() comment callback
  objectComments.forEach(({ path, comment: commentText }) => {
    const node = originalYamlDocument.getIn(path, true);
    if (node) {
      const prevComment = (node as any)['commentBefore'];
      (node as any)['commentBefore'] = ' ' + commentText;

      // If we're adding a comment to an empty object/array, ensure it's not in flow style
      if (commentText && (node as any).type === 'MAP' && (node as any).items && (node as any).items.length === 0) {
        (node as any).flow = false;
      }

      comments.push({
        path,
        comment: commentText
      });
    }
  });

  // Then apply comment instructions from addInstructions
  commentInstructionsMap.forEach((instructions, pathKey) => {
    const path = JSON.parse(pathKey) as (string | number)[];
    const node = originalYamlDocument.getIn(path, true);

    if (node) {
      if (instructions.removeComment) {
        // Remove existing comment
        (node as any)['commentBefore'] = undefined;
      } else if (instructions.comment) {
        // Add or replace comment
        (node as any)['commentBefore'] = ' ' + instructions.comment;

        comments.push({
          path,
          comment: instructions.comment
        });
      } else if (instructions.commentBefore) {
        // Add comment before (same as comment in YAML)
        (node as any)['commentBefore'] = ' ' + instructions.commentBefore;

        comments.push({
          path,
          comment: instructions.commentBefore
        });
      }

      // If we're adding a comment to an empty object/array, ensure it's not in flow style
      if ((instructions.comment || instructions.commentBefore) && (node as any).type === 'MAP' && (node as any).items && (node as any).items.length === 0) {
        (node as any).flow = false;
      }
    }
  });

  // Step 6: Stringify YAML
  const result = originalYamlDocument.toString({ lineWidth: 0 });

  return {
    result,
    resultParsed: updatedObject,
    originalParsed,
    comments
  };
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
  const node = originalYamlDocument.getIn(path, true) as any;
  if (!node) {
    return;
  }

  const isEmptyObject = node.items && Array.isArray(node.items) && node.items.length === 0;
  const isEmptyArray = node.items && node.items.size === 0;

  if (node.flow == true && (node.content == '{}' || node.content == '[]' || node.content == null || node.content == undefined || isEmptyObject || isEmptyArray)) {
    node.flow = false;
  }

  if (node.type === 'MAP' && node.items && node.items.length === 0 && node.commentBefore) {
    node.flow = false;
  }
}
