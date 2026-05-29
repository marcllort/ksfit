import { Card, CardHeader, Pill } from "@/components/ui";
import { SETTINGS, type SettingId } from "@/lib/settings/definitions";
import { NumberSettingField } from "./number-field";

/**
 * Renders one settings card by id — picks the field component matching the
 * setting's kind, derives "Default" / "Custom" badge from the saved value.
 * New setting kinds add one `case` here plus a sibling field component.
 */
export function SettingCard({
  id,
  saved,
}: {
  id: SettingId;
  saved: unknown;
}) {
  const def = SETTINGS[id];
  const isDefault = saved === def.default;

  return (
    <Card>
      <CardHeader
        title={def.label}
        hint={def.description}
        action={
          <Pill tone={isDefault ? "muted" : "accent"}>
            {isDefault ? "Default" : "Custom"}
          </Pill>
        }
      />
      {def.kind === "number" ? (
        <NumberSettingField id={id} saved={saved as number} />
      ) : null}
    </Card>
  );
}
