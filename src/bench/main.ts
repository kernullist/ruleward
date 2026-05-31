import { runBench } from './run';
import { formatReport } from './report';

const report = await runBench();
console.log(formatReport(report));

const { totals } = report;
const recall = totals.tp + totals.fn === 0 ? 1 : totals.tp / (totals.tp + totals.fn);
const ok = totals.negativeFp === 0 && totals.errorFp === 0 && recall >= 0.85;

if (!ok) {
  console.error('\n❌ 임계 미달: negativeFp=0, errorFp=0, recall>=0.85 를 만족해야 함.');
  process.exitCode = 1;
} else {
  console.log('\n✓ 임계 통과 (negativeFp=0, errorFp=0, recall>=0.85).');
}
