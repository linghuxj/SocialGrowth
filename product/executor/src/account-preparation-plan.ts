import { preparationExecutionLibrary, type PreparationOperationId } from "@socialgrowth/product-contracts";
export { planAccountPreparation, type AccountPreparationPlan } from "@socialgrowth/product-contracts";

export function preparationInstructions(id: PreparationOperationId): string {
  const operation = preparationExecutionLibrary.find(o => o.id === id);
  if (!operation) throw new Error("PREPARATION_OPERATION_UNKNOWN");
  return `Use Google Artemis visual observation and autonomous decisions for this scoped operation.\n${operation.instructions}\nA library instruction is not permission: stop unless current server permission and exclusive device control authorize each action. Return real observations and evidence; completion alone never proves acceptance.`;
}
