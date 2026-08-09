import type { IConfiguration, ICruiseOptions, IForbiddenRuleType } from "dependency-cruiser";

interface CashmemoDependencyCruiserConfig extends IConfiguration {
  forbidden: IForbiddenRuleType[];
  options: ICruiseOptions;
}

declare const config: CashmemoDependencyCruiserConfig;

declare const moduleNames: readonly string[];

export { moduleNames };
export default config;
