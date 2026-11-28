import { dispatch, latest, prepare } from './gosplan.mjs';
import { worker } from './worker.mjs';
import { voenpred } from './voenpred.mjs';
import { politruk } from './politruk.mjs';
import { retry, settle } from './fallback.mjs';

export async function execute(root, control) {
  if (control) await prepare(root,control);
  for (;;) {
    const ledger = await latest(root);
    if (!ledger) throw new Error('먼저 지시 폴더를 지정하세요.');
    const task = ledger.tasks.find(t=>t.state !== 'DONE');
    if (!task) return {status:'done',head:ledger.head,tasks:ledger.tasks.map(t=>({id:t.id,head:t.merged}))};
    if (['QUARANTINED','PURGING'].includes(task.state) || task.worker?.status === 'RUNNING' || task.politruk?.status === 'RUNNING') {
      return {status:'pending',id:task.id,state:task.state,reason:task.hold ?? '기존 실행 예약을 확인하세요.'};
    }
    if (task.worker?.status === 'FAILED') return retry(root);
    if (['PENDING','PURGED'].includes(task.state)) await dispatch(root);
    else if (task.state === 'IN_PROGRESS' && !task.worker) {
      try { await worker(root); }
      catch (error) {
        const after = await latest(root);
        if (after.tasks.find(t=>t.id===task.id)?.worker?.status !== 'FAILED') throw error;
        return retry(root);
      }
    } else if (task.state === 'IN_PROGRESS' && !task.voenpred) await voenpred(root);
    else if (task.state === 'VOENPRED_PASS' && !task.politruk) await politruk(root);
    else if (task.state === 'POLITRUK_PASS') {
      const result = await settle(root,'integrate');
      if (result.status === 'pending') return result;
    } else if (['IN_PROGRESS','VOENPRED_PASS'].includes(task.state)) {
      const result = await retry(root);
      if (result.status === 'pending') return result;
    } else throw new Error('알 수 없는 원장 상태 · ' + task.state);
  }
}
