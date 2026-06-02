import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface CategoryVisibilityItem {
    id: string;
    name: string;
}

export interface CategoryVisibilityDialogData {
    categories: CategoryVisibilityItem[];
    hiddenIds: string[];
}

interface CategoryWithSelection extends CategoryVisibilityItem {
    selected: boolean;
}

@Component({
    selector: 'app-category-visibility-dialog',
    imports: [
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
    ],
    templateUrl: './category-visibility-dialog.component.html',
    styleUrl: './category-visibility-dialog.component.scss',
})
export class CategoryVisibilityDialogComponent {
    private readonly dialogRef = inject(
        MatDialogRef<CategoryVisibilityDialogComponent>
    );
    readonly data = inject<CategoryVisibilityDialogData>(MAT_DIALOG_DATA);

    readonly searchTerm = signal('');
    readonly categories = signal<CategoryWithSelection[]>(
        this.data.categories.map((category) => ({
            ...category,
            selected: !this.data.hiddenIds.includes(category.id),
        }))
    );

    readonly filteredCategories = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        if (!term) {
            return this.categories();
        }

        return this.categories().filter((category) =>
            category.name.toLowerCase().includes(term)
        );
    });

    readonly selectedCount = computed(
        () => this.categories().filter((category) => category.selected).length
    );

    readonly totalCount = computed(() => this.categories().length);

    readonly allSelected = computed(
        () =>
            this.categories().length > 0 &&
            this.categories().every((category) => category.selected)
    );

    toggleCategory(category: CategoryWithSelection): void {
        this.categories.update((items) =>
            items.map((item) =>
                item.id === category.id
                    ? { ...item, selected: !item.selected }
                    : item
            )
        );
    }

    selectAll(): void {
        this.categories.update((items) =>
            items.map((item) => ({ ...item, selected: true }))
        );
    }

    deselectAll(): void {
        this.categories.update((items) =>
            items.map((item) => ({ ...item, selected: false }))
        );
    }

    clearSearch(): void {
        this.searchTerm.set('');
    }

    save(): void {
        const hiddenIds = this.categories()
            .filter((category) => !category.selected)
            .map((category) => category.id);

        this.dialogRef.close(hiddenIds);
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }
}
