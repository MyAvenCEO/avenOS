type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type TreeNodePath = Brand<string, "TreeNodePath">;

export interface TreeNodeRef {
  readonly path: TreeNodePath;
}

export function normalizeTreeNodePath(path: string): TreeNodePath {
  if (path === "/") {
    return path as TreeNodePath;
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return (`/${segments.join("/")}`) as TreeNodePath;
}

export function treeNodeRef(path: string): TreeNodeRef {
  return { path: normalizeTreeNodePath(path) };
}

export function treeNodePathSegments(path: TreeNodePath): readonly string[] {
  if (path === "/") {
    return [];
  }
  return path.slice(1).split("/");
}

export function treeNodeParentPath(path: TreeNodePath): TreeNodePath | undefined {
  const segments = treeNodePathSegments(path);
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.length === 1) {
    return "/" as TreeNodePath;
  }
  return (`/${segments.slice(0, -1).join("/")}`) as TreeNodePath;
}

export function treeNodeLastSegment(path: TreeNodePath): string {
  const segments = treeNodePathSegments(path);
  return segments.at(-1) ?? "/";
}

export function joinTreeNodePath(basePath: TreeNodePath, childPath: string): TreeNodePath {
  if (childPath.startsWith("/")) {
    return normalizeTreeNodePath(childPath);
  }
  const normalizedChild = childPath.split("/").filter((segment) => segment.length > 0).join("/");
  return normalizeTreeNodePath(basePath === "/" ? `/${normalizedChild}` : `${basePath}/${normalizedChild}`);
}

export function isTreeNodeDescendantOrSelf(path: TreeNodePath, ancestor: TreeNodePath): boolean {
  if (path === ancestor) {
    return true;
  }
  if (ancestor === "/") {
    return true;
  }
  return path.startsWith(`${ancestor}/`);
}