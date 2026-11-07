import { enterpriseRequiresManagement } from '@aivilization/enterprise';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import { enterpriseMayOperate, enterpriseManagementAuthority } from '@aivilization/enterprise';
import {
  evaluateExternalExportPrice,
  evaluateExternalImportPrice,
  getInventoryQuantity,
  resolveInventoryRequest,
  getSpotPrice,
  type ExternalTradePolicy,
  type ExternalTradePriceQuote,
} from '@aivilization/economy';
import { isEnterpriseOperational } from '@aivilization/enterprise';
import type { CommandEnvelope } from '@aivilization/sim-core';
import { assertAgentExportCommodityPayload, assertAgentImportCommodityPayload } from '../commands';
import type { ExternalTradeActor, WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { resolveAgentRegion, resolveMarketPool } from '../regionalMarkets';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  type WorldCommandHandlerInput,
} from './shared';

/**
 * External-trade command handlers (town ↔ external sector). The world layer
 * owns identity, enterprise authorization, regional spot-price resolution and
 * the inventory/cash checks; the pricing rule (rolling net-export balance with
 * a saturating √balance impact) is pure domain math in `@aivilization/economy`.
 * Exports inject currency from the external sector (moneySupply rises) and
 * imports burn into it (moneySupply falls); no export tax is charged because
 * an export is an external injection, not domestic sale revenue.
 */
export function handleAgentExportCommodityCommand(input: {
  readonly command: CommandEnvelope<'AgentExportCommodity', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ExternalTradePolicy;
  readonly enterpriseAuthorization?: ControlAuthorizationPort;
  readonly regionalMarketsEnabled?: boolean;
  readonly nextSequence: number;
}): WorldEvent[] {
  const payloadResult = parsePayload(() =>
    assertAgentExportCommodityPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentExportCommodity', payloadResult.reason);
  }
  return settleExternalTrade(input, 'export', payloadResult.payload);
}

export function handleAgentImportCommodityCommand(input: {
  readonly command: CommandEnvelope<'AgentImportCommodity', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ExternalTradePolicy;
  readonly enterpriseAuthorization?: ControlAuthorizationPort;
  readonly regionalMarketsEnabled?: boolean;
  readonly nextSequence: number;
}): WorldEvent[] {
  const payloadResult = parsePayload(() =>
    assertAgentImportCommodityPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentImportCommodity', payloadResult.reason);
  }
  return settleExternalTrade(input, 'import', payloadResult.payload);
}

function settleExternalTrade(
  input: WorldCommandHandlerInput & {
    readonly policy: ExternalTradePolicy;
    readonly enterpriseAuthorization?: ControlAuthorizationPort;
    readonly regionalMarketsEnabled?: boolean;
  },
  direction: 'export' | 'import',
  payload: {
    readonly commodityName: string;
    readonly quantity: number;
    readonly asEnterpriseId?: string;
  },
): WorldEvent[] {
  const commandType = direction === 'export' ? 'AgentExportCommodity' : 'AgentImportCommodity';
  const agent = resolveCommandAgent(input.projection, input.command);

  const enterprise =
    payload.asEnterpriseId === undefined
      ? undefined
      : input.projection.enterprises[payload.asEnterpriseId];
  if (payload.asEnterpriseId !== undefined) {
    if (enterprise === undefined || !isEnterpriseOperational(enterprise)) {
      return rejectCommand(input, commandType, 'enterprise is missing or closed');
    }
    if (
      !enterpriseMayOperate(enterprise, agent.agentId, direction, input.enterpriseAuthorization)
    ) {
      return rejectCommand(input, commandType, 'agent is not authorized for enterprise');
    }
  }

  // The external sector quotes off the domestic spot price of the market the
  // trader actually stands in — the same regional resolution as AgentTrade.
  const regionalMarketsEnabled = input.regionalMarketsEnabled === true;
  const agentRegionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: agent.locationId,
  });
  const requestedRegionId = regionalMarketsEnabled ? agentRegionId : undefined;
  const pool = resolveMarketPool(input.projection, {
    regionId: requestedRegionId,
    commodity: payload.commodityName,
  });
  if (pool === undefined) {
    const regionHint =
      regionalMarketsEnabled && requestedRegionId !== undefined
        ? ` in region ${requestedRegionId}`
        : '';
    return rejectCommand(
      input,
      commandType,
      `missing AMM pool for ${payload.commodityName}${regionHint}`,
    );
  }
  const spotPrice = getSpotPrice(pool);

  const available = getInventoryQuantity(
    enterprise?.inventory ?? agent.inventory,
    payload.commodityName,
  );
  const resolved =
    direction === 'export'
      ? resolveInventoryRequest(available, payload.quantity)
      : { quantity: payload.quantity };
  if (!resolved)
    return rejectCommand(
      input,
      commandType,
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${available}`,
    );
  const quantity = resolved.quantity;

  const balanceBefore =
    input.projection.externalTrade?.balancesByCommodity[payload.commodityName] ?? 0;
  const quoteResult = parsePayload(() =>
    direction === 'export'
      ? evaluateExternalExportPrice({
          spotPrice,
          quantity,
          netExportBalance: balanceBefore,
          policy: input.policy,
        })
      : evaluateExternalImportPrice({
          spotPrice,
          quantity,
          netExportBalance: balanceBefore,
          policy: input.policy,
        }),
  );
  if (quoteResult.status === 'invalid') {
    return rejectCommand(input, commandType, quoteResult.reason);
  }
  const quote: ExternalTradePriceQuote = quoteResult.payload;

  if (direction === 'export') {
    if (quote.total <= 0) {
      return rejectCommand(
        input,
        commandType,
        `external export price collapsed to zero at trade balance ${balanceBefore}`,
      );
    }
  } else {
    const availableBalance = enterprise?.balance ?? agent.balance;
    if (availableBalance < quote.total) {
      return rejectCommand(
        input,
        commandType,
        `insufficient balance: required ${quote.total}, available ${availableBalance}`,
      );
    }
  }

  const trader: ExternalTradeActor =
    payload.asEnterpriseId === undefined
      ? { agentId: agent.agentId }
      : { enterpriseId: payload.asEnterpriseId };
  const balanceAfter = direction === 'export' ? balanceBefore + quantity : balanceBefore - quantity;

  return [
    makeEvent(input, 0, 'ExternalTradeExecuted', {
      ...(enterprise && enterpriseRequiresManagement(enterprise)
        ? {
            managementAuthority: enterpriseManagementAuthority(
              enterprise,
              agent.agentId,
              direction,
              input.enterpriseAuthorization,
            )!,
          }
        : {}),
      trader,
      direction,
      commodityName: payload.commodityName,
      quantity,
      ...(resolved.quantityResolution ? { quantityResolution: resolved.quantityResolution } : {}),
      unitPrice: quote.unitPrice,
      totalCurrency: quote.total,
      balanceBefore,
      balanceAfter,
      spotPrice,
      policyVersion: input.policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary:
        direction === 'export'
          ? `Exported ${quantity} ${payload.commodityName} to the external market for ${quote.total}.`
          : `Imported ${quantity} ${payload.commodityName} from the external market for ${quote.total}.`,
      status: 'succeeded',
      sourceEventOffsets: [0],
      tags: [
        'external-trade',
        direction,
        payload.commodityName,
        ...(payload.asEnterpriseId === undefined ? [] : [payload.asEnterpriseId]),
      ],
    }),
  ];
}
