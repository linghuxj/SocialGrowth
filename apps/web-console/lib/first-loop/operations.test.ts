import test from 'node:test';
import assert from 'node:assert/strict';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import { href, readRoute, taskList, validRelation, reviewedCompletion } from '../operations.ts';
const context = {actorId:'test-operator',correlationId:'operations-refactor'};
void test('account names and same-platform device binding are unique, clients keep independent ownership', () => {
  const e = new FirstLoopEngine();
  assert.equal(e.registerClient('星河',context).ok,true);
  assert.equal(e.registerClient(' 星河 ',context).ok,false);
  const input = {name:'English Channel',platform:'youtube' as const,owner:'内容所有方',positioning:'英语受众',deviceRef:'physical-1'};
  assert.equal(e.registerAccount(input,context).ok,true);
  assert.equal(e.registerAccount({...input,name:'Other'},context).error?.code,'ACCOUNT_BINDING_CONFLICT');
  assert.equal(e.registerAccount({...input,platform:'facebook'},context).ok,true);
  assert.equal(e.snapshot().auditLogs.filter((x)=>x.result==='rejected').length,2);
});
void test('routes retain page, object and search across reload/back without global project context', () => {
  assert.deepEqual(readRoute(href('accounts','abc','星河')),{page:'accounts',object:'abc',query:'星河'});
  assert.equal(readRoute('#/unregistered').page,'home');
});
void test('work queue spans service scopes and treats expiry as unavailable', () => {
  const state = createEmptyFirstLoopState();
  const e = new FirstLoopEngine(state);
  e.saveProjectDraft({name:'客户甲'},context);
  e.saveProjectDraft({name:'客户乙'},context);
  assert.equal(taskList(e.snapshot()).length,2);
  assert.equal(reviewedCompletion(e.snapshot(),'absent'),false);
  assert.equal(validRelation({id:'r',createdAt:'',accountId:'a',projectId:'p',clientId:'c',ownerPartyId:'o',authorizerPartyId:'o',authorizationRef:'ref',allowedActions:['publish'],allowedData:[],validFrom:'2026-01-01',validUntil:'2026-02-01'}, Date.parse('2026-03-01')), false);
});
void test('authorization cannot silently select another customer or an invalid date', () => {
  const e = new FirstLoopEngine();
  const p = e.saveProjectDraft({name:'甲服务',clientId:'client-a'},context).value!;
  const relation={projectId:p.id,accountId:'a',clientId:'client-b',ownerPartyId:'owner',authorizerPartyId:'authorizer',authorizationRef:'auth',allowedActions:['publish'],allowedData:[],validFrom:'2026-01-01'};
  assert.equal(e.grantAccountServiceRelation(relation,context).error?.code,'AUTHORIZATION_PROJECT_MISMATCH');
  assert.equal(e.grantAccountServiceRelation({...relation,clientId:'client-a',validFrom:'invalid'},context).error?.code,'AUTHORIZATION_PERIOD_INVALID');
});
void test('approval and schedule reject blank conditions, expired authority and inverted windows', () => {
  const state = createEmptyFirstLoopState();
  state.strategyDrafts.push({id:'d',projectId:'p',version:1,ruleIds:[],contentIdentityId:'c',accountId:'a',destinationVersionId:'v',rationale:'r',assumptions:[],evidenceRefs:[],outputMode:'controlled',createdAt:'2026-09-20T00:00:00Z'});
  const e = new FirstLoopEngine(state,{now:()=> '2026-09-20T00:00:00Z'});
  assert.equal(e.approveStrategy({strategyDraftId:'d',expectedStrategyVersion:1,quantity:1,validFrom:'2026-09-20',validUntil:'2026-09-22',stopConditions:[' '],observationConditions:['record']},context).error?.code,'APPROVAL_SCOPE_INCOMPLETE');
  state.executionApprovals.push({id:'a',projectId:'p',strategyDraftId:'d',strategyVersion:1,contentIdentityId:'c',accountId:'acc',destinationVersionId:'v',quantity:1,validFrom:'2026-09-20T00:00:00Z',validUntil:'2026-09-22T00:00:00Z',stopConditions:['stop'],observationConditions:['observe'],status:'active',approvedBy:'op',createdAt:'2026-09-20T00:00:00Z'});
  e.replaceState(state);
  assert.equal(e.scheduleApproval({approvalId:'a',businessTimezone:'Asia/Shanghai',scheduledFor:'2026-09-19',expiresAt:'2026-09-21'},context).error?.code,'SCHEDULE_WINDOW_INVALID');
  assert.equal(e.scheduleApproval({approvalId:'a',businessTimezone:'Invalid/Zone',scheduledFor:'2026-09-21',expiresAt:'2026-09-22'},context).ok,false);
});
