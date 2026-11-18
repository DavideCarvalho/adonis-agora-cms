---
'@adonis-agora/cms-admin': patch
---

The list's relation filter is a searchable combobox: typing searches the related collection on the server (by its title field), so relations with more than 100 documents stay filterable, and a picked document outside the first page keeps its label. Option filters with more than 6 options are searchable comboboxes too. Console kit re-synced (ComboSelect / ComboMultiSelect).
