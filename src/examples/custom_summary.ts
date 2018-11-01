import { RuntimeCase, RuntimeCaseType } from "..";
import { ICaseResult } from "../interfaces";
import { descriptiveStats } from "../helper";

/**
 * Example to show how to add summary stats to baseline and eval
 *   ==>  any key/value pair under .summary is respected if value
 *        contains values and descriptiveStats
 * 
 * Example adds:
 *    summary
 *      -- custom*
 *      -- customWithSubs
 *            -- sub1*
 *            -- sub2
 *                  --subsub*
 * 
 * (* - stats appearing in final reports)
 */
new RuntimeCase('add summary stats', () => {})
.postAll((_: ICaseResult[], perf: RuntimeCaseType) => {
  const values = [1,2,3,4,5];
  perf.summary['custom'] = Object.assign({values}, descriptiveStats(values));
  perf.summary['customWithSubs'] = {
    sub1: Object.assign({values}, descriptiveStats(values)),
    sub2: {
      subsub: Object.assign({values}, descriptiveStats(values))
    }
  };
});
