import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import { useMessagesStore } from '../store/messagesStore';

beforeEach(() => {
    // Reset the messages store to a known baseline. Default filters: every
    // direction + every kind enabled, streams collapsed, hideBoilerplate off.
    useMessagesStore.setState({
        filters: {
            directions: new Set(['editor-to-agent', 'agent-to-editor']),
            kinds: new Set(['request', 'response', 'notification', 'error', 'unknown']),
            search: '',
            hideBoilerplate: false,
            showStreams: true,
        },
    });
});

describe('FilterBar — direction chips', () => {
    it('renders → OUT and ← IN chips', () => {
        render(<FilterBar />);
        expect(screen.getByRole('button', { name: /→ OUT/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /← IN/ })).toBeInTheDocument();
    });
    it('clicking → OUT toggles the direction filter', () => {
        render(<FilterBar />);
        fireEvent.click(screen.getByRole('button', { name: /→ OUT/ }));
        expect(useMessagesStore.getState().filters.directions.has('editor-to-agent')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: /→ OUT/ }));
        expect(useMessagesStore.getState().filters.directions.has('editor-to-agent')).toBe(true);
    });
});

describe('FilterBar — kind chips', () => {
    it('renders one chip per kind plus stream', () => {
        render(<FilterBar />);
        for (const kind of ['request', 'response', 'notification', 'error', 'unknown']) {
            expect(
                screen.getByRole('button', { name: new RegExp(`^${kind}$`, 'i') }),
            ).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: /^stream$/i })).toBeInTheDocument();
    });
    it('clicking a kind toggles it in the store', () => {
        render(<FilterBar />);
        fireEvent.click(screen.getByRole('button', { name: /^request$/i }));
        expect(useMessagesStore.getState().filters.kinds.has('request')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: /^request$/i }));
        expect(useMessagesStore.getState().filters.kinds.has('request')).toBe(true);
    });
    it('clicking the stream chip toggles showStreams', () => {
        render(<FilterBar />);
        fireEvent.click(screen.getByRole('button', { name: /^stream$/i }));
        expect(useMessagesStore.getState().filters.showStreams).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: /^stream$/i }));
        expect(useMessagesStore.getState().filters.showStreams).toBe(true);
    });
});

describe('FilterBar — hide boilerplate checkbox', () => {
    it('starts unchecked when filters.hideBoilerplate is false', () => {
        render(<FilterBar />);
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).not.toBeChecked();
    });
    it('toggles filters.hideBoilerplate when clicked', () => {
        render(<FilterBar />);
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(useMessagesStore.getState().filters.hideBoilerplate).toBe(true);
        fireEvent.click(checkbox);
        expect(useMessagesStore.getState().filters.hideBoilerplate).toBe(false);
    });
});

describe('FilterBar — search input', () => {
    it('updates filters.search as the user types', () => {
        render(<FilterBar />);
        const input = screen.getByPlaceholderText(/search payload/i);
        fireEvent.change(input, { target: { value: 'session/prompt' } });
        expect(useMessagesStore.getState().filters.search).toBe('session/prompt');
    });
    it('reflects external store updates back into the input value', () => {
        render(<FilterBar />);
        act(() => {
            useMessagesStore.setState((state) => ({
                filters: { ...state.filters, search: 'initialize' },
            }));
        });
        const input = screen.getByPlaceholderText(/search payload/i) as HTMLInputElement;
        expect(input.value).toBe('initialize');
    });
});
