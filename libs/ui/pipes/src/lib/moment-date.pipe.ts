import { Pipe, PipeTransform } from '@angular/core';
import * as momentNs from 'moment';

/**
 * Moment.js based pipe to parse and return the provided date based on given params.
 * Auto-detects ISO 8601 format and converts to user's local timezone.
 * Optionally accepts a format string for non-ISO date strings.
 */
@Pipe({
    name: 'momentDate',
    standalone: true,
})
export class MomentDatePipe implements PipeTransform {
    transform(
        value: string,
        formatToReturn = 'MMMM Do, dddd',
        formatToParse?: string
    ): string {
        const momentFn = (momentNs as unknown as { default?: typeof import('moment') }).default;
        const parse = momentFn ?? (momentNs as unknown as typeof import('moment'));

        // If formatToParse is provided, use it; otherwise auto-detect (works for ISO 8601)
        const parsed = formatToParse
            ? parse(value, formatToParse)
            : parse(value);
        return parsed.format(formatToReturn);
    }
}
