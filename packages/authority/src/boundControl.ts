import {
  assertPrincipalAuthorization,
  assertPrincipalControlRequest,
  type PrincipalAuthorization,
  type PrincipalControlRequest,
} from './principal';
import { principalOperationKey, type PrincipalOperationRequest } from './principalOperation';

/**
 * A parent operation must explicitly include the exact child control effect.
 * This proves scope only. The application must verify the parent source against
 * current authority and commit its child with the parent; ordinary world control
 * entry points still require their own source and cannot use this as a shortcut.
 */
export function boundPrincipalControlEffect(
  parent: PrincipalAuthorization<PrincipalOperationRequest>,
  child: PrincipalControlRequest,
): PrincipalAuthorization {
  assertPrincipalAuthorization(parent, parent.principal, parent.request, parent.actorId);
  assertPrincipalControlRequest(child);
  const declared = parent.request.operation.arguments.controlEffect;
  if (
    !['accept', 'cancel'].includes(child.command.type) ||
    !declared ||
    typeof declared !== 'object' ||
    Array.isArray(declared) ||
    principalOperationKey(declared) !== principalOperationKey(child)
  )
    throw Error('principal-control-not-bound-to-parent-operation');
  return {
    actorId: parent.actorId,
    principal: { ...parent.principal },
    request: structuredClone(child),
    source: { ...parent.source },
  };
}
