import {
  groupLabelForRoutePath as groupLabelForRoutePathRaw,
  sortGroupLabels as sortGroupLabelsRaw,
} from "./search-group.mjs";

export const groupLabelForRoutePath = groupLabelForRoutePathRaw as (
  routePath: string,
) => string;

export const sortGroupLabels = sortGroupLabelsRaw as (
  labels: string[],
) => string[];
