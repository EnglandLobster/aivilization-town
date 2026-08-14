import type { CommandEnvelope } from '@aivilization/sim-core';
import {
  assertAgentCloseEnterprisePayload,
  assertAgentFoundEnterprisePayload,
  assertAgentFundEnterprisePayload,
  assertAgentJoinEnterprisePayload,
  assertAgentLayoffEnterpriseEmployeePayload,
  assertAgentLeaveEnterprisePayload,
  assertAgentSetEnterpriseJobPostingPayload,
} from '../commands';
import {
  decideCloseEnterprise,
  decideFoundEnterprise,
  decideFundEnterprise,
  decideJoinEnterprise,
  decideLayoffEmployee,
  decideLeaveEnterprise,
  decideSetEnterpriseJobPosting,
  isEnterpriseOperational,
  type EnterprisePolicy,
} from '../enterprise';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentFoundEnterpriseCommand(input: {
  readonly command: CommandEnvelope<'AgentFoundEnterprise', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const owner = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentFoundEnterprisePayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentFoundEnterprise', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  if (owner.balance < payload.initialCapital) {
    return rejectCommand(
      input,
      'AgentFoundEnterprise',
      `insufficient balance: required ${payload.initialCapital}, available ${owner.balance}`,
    );
  }
  const decisionResult = parsePayload(() =>
    decideFoundEnterprise({
      existing: input.projection.enterprises[payload.enterpriseId],
      enterpriseId: payload.enterpriseId,
      name: payload.name,
      ownerAgentId: owner.agentId,
      occupationName: payload.occupationName,
      initialCapital: payload.initialCapital,
      maxEmployees: payload.maxEmployees,
      occurredAt: input.projection.clock.now,
      policy: input.policy,
    }),
  );
  if (decisionResult.status === 'invalid') {
    return rejectCommand(input, 'AgentFoundEnterprise', decisionResult.reason);
  }
  if (decisionResult.payload.status === 'rejected') {
    return rejectCommand(input, 'AgentFoundEnterprise', decisionResult.payload.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseFounded', {
      enterpriseId: payload.enterpriseId,
      name: payload.name,
      ownerAgentId: owner.agentId,
      occupationName: payload.occupationName,
      initialCapital: payload.initialCapital,
      ownerPreviousBalance: owner.balance,
      ownerNextBalance: owner.balance - payload.initialCapital,
      maxEmployees: payload.maxEmployees,
      policyVersion: input.policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Founded ${payload.name} with ${payload.initialCapital} capital.`,
      status: 'succeeded',
      tags: ['enterprise', 'founded', payload.enterpriseId, payload.occupationName],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentJoinEnterpriseCommand(input: {
  readonly command: CommandEnvelope<'AgentJoinEnterprise', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentJoinEnterprisePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentJoinEnterprise', payloadResult.reason);
  }
  const enterprise = input.projection.enterprises[payloadResult.payload.enterpriseId];
  if (enterprise === undefined || enterprise.status !== 'active') {
    return rejectCommand(input, 'AgentJoinEnterprise', 'enterprise is missing or closed');
  }
  if (agent.job !== null) {
    return rejectCommand(input, 'AgentJoinEnterprise', `agent already has job ${agent.job}`);
  }
  const decision = decideJoinEnterprise({ enterprise, agentId: agent.agentId });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentJoinEnterprise', decision.reason);
  }
  const joined = decision.events.find((event) => event.type === 'EnterpriseMemberJoined');
  return [
    makeEvent(input, 0, 'EnterpriseMemberJoined', {
      enterpriseId: enterprise.enterpriseId,
      agentId: agent.agentId,
      occupationName: enterprise.occupationName,
      previousJob: agent.job,
      ...(joined?.type === 'EnterpriseMemberJoined' && joined.wageOffer !== undefined
        ? { wageOffer: joined.wageOffer }
        : {}),
    }),
    makeMemoryEvent(input, 1, {
      summary: `Joined ${enterprise.name} as ${enterprise.occupationName}.`,
      status: 'succeeded',
      tags: ['enterprise', 'joined', enterprise.enterpriseId, enterprise.occupationName],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentSetEnterpriseJobPostingCommand(input: {
  readonly command: CommandEnvelope<'AgentSetEnterpriseJobPosting', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const owner = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentSetEnterpriseJobPostingPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSetEnterpriseJobPosting', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const enterprise = input.projection.enterprises[payload.enterpriseId];
  if (enterprise === undefined) {
    return rejectCommand(input, 'AgentSetEnterpriseJobPosting', 'enterprise is missing');
  }
  const decision = decideSetEnterpriseJobPosting({
    enterprise,
    actorAgentId: owner.agentId,
    wageOffer: payload.wageOffer,
    openSlots: payload.openSlots,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentSetEnterpriseJobPosting', decision.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseJobPostingUpdated', {
      enterpriseId: enterprise.enterpriseId,
      ownerAgentId: owner.agentId,
      wageOffer: payload.wageOffer,
      openSlots: payload.openSlots,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Published a job posting at ${enterprise.name}: wage ${payload.wageOffer}, ${payload.openSlots} open slots.`,
      status: 'succeeded',
      tags: ['enterprise', 'job-posting', enterprise.enterpriseId],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentLeaveEnterpriseCommand(input: {
  readonly command: CommandEnvelope<'AgentLeaveEnterprise', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentLeaveEnterprisePayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentLeaveEnterprise', payloadResult.reason);
  }
  const enterprise = input.projection.enterprises[payloadResult.payload.enterpriseId];
  if (enterprise === undefined) {
    return rejectCommand(input, 'AgentLeaveEnterprise', 'enterprise is missing');
  }
  const decision = decideLeaveEnterprise({ enterprise, agentId: agent.agentId });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentLeaveEnterprise', decision.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseEmployeeLeft', {
      enterpriseId: enterprise.enterpriseId,
      agentId: agent.agentId,
      occupationName: enterprise.occupationName,
      previousJob: agent.job,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Left ${enterprise.name}.`,
      status: 'succeeded',
      tags: ['enterprise', 'left', enterprise.enterpriseId],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentLayoffEnterpriseEmployeeCommand(input: {
  readonly command: CommandEnvelope<'AgentLayoffEnterpriseEmployee', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const owner = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentLayoffEnterpriseEmployeePayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentLayoffEnterpriseEmployee', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const enterprise = input.projection.enterprises[payload.enterpriseId];
  if (enterprise === undefined) {
    return rejectCommand(input, 'AgentLayoffEnterpriseEmployee', 'enterprise is missing');
  }
  const employee = input.projection.agents[payload.employeeAgentId];
  if (employee === undefined) {
    return rejectCommand(input, 'AgentLayoffEnterpriseEmployee', 'employee agent is missing');
  }
  const decision = decideLayoffEmployee({
    enterprise,
    actorAgentId: owner.agentId,
    employeeAgentId: employee.agentId,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentLayoffEnterpriseEmployee', decision.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseEmployeeLaidOff', {
      enterpriseId: enterprise.enterpriseId,
      agentId: employee.agentId,
      occupationName: enterprise.occupationName,
      previousJob: employee.job,
    }),
    makeMemoryEvent(input, 1, {
      agentId: employee.agentId,
      summary: `Were laid off from ${enterprise.name}.`,
      status: 'succeeded',
      tags: ['enterprise', 'laid-off', enterprise.enterpriseId],
      sourceEventOffsets: [0],
    }),
    makeMemoryEvent(input, 2, {
      summary: `Laid off ${employee.agentId} from ${enterprise.name}.`,
      status: 'succeeded',
      tags: ['enterprise', 'layoff', enterprise.enterpriseId],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentFundEnterpriseCommand(input: {
  readonly command: CommandEnvelope<'AgentFundEnterprise', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const funder = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentFundEnterprisePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentFundEnterprise', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const enterprise = input.projection.enterprises[payload.enterpriseId];
  if (enterprise === undefined || !isEnterpriseOperational(enterprise)) {
    return rejectCommand(input, 'AgentFundEnterprise', 'enterprise is missing or closed');
  }
  if (funder.balance < payload.amount) {
    return rejectCommand(
      input,
      'AgentFundEnterprise',
      `insufficient balance: required ${payload.amount}, available ${funder.balance}`,
    );
  }
  const decision = decideFundEnterprise({ enterprise, amount: payload.amount });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentFundEnterprise', decision.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseFunded', {
      enterpriseId: enterprise.enterpriseId,
      funderAgentId: funder.agentId,
      amount: payload.amount,
      funderPreviousBalance: funder.balance,
      funderNextBalance: funder.balance - payload.amount,
      enterprisePreviousBalance: enterprise.balance,
      enterpriseNextBalance: enterprise.balance + payload.amount,
    }),
  ];
}

export function handleAgentCloseEnterpriseCommand(input: {
  readonly command: CommandEnvelope<'AgentCloseEnterprise', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EnterprisePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const owner = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentCloseEnterprisePayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentCloseEnterprise', payloadResult.reason);
  }
  const enterprise = input.projection.enterprises[payloadResult.payload.enterpriseId];
  if (enterprise === undefined || enterprise.status === 'closed') {
    return rejectCommand(input, 'AgentCloseEnterprise', 'enterprise is missing or closed');
  }
  const decision = decideCloseEnterprise({
    enterprise,
    actorAgentId: owner.agentId,
    closedAt: input.projection.clock.now,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentCloseEnterprise', decision.reason);
  }
  return [
    makeEvent(input, 0, 'EnterpriseClosed', {
      enterpriseId: enterprise.enterpriseId,
      ownerAgentId: owner.agentId,
      returnedBalance: enterprise.balance,
      returnedInventory: { ...enterprise.inventory },
      employeeAgentIds: [...enterprise.employeeAgentIds],
      reason: 'owner-closed',
    }),
    makeMemoryEvent(input, 1, {
      summary: `Closed ${enterprise.name} and liquidated its remaining assets.`,
      status: 'succeeded',
      tags: ['enterprise', 'closed', enterprise.enterpriseId],
      sourceEventOffsets: [0],
    }),
  ];
}
