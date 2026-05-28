import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import {
    ALL_DIRECTIONS,
    ALL_KINDS,
    useMessagesStore,
} from '../store/messagesStore';
import { useDiscoveryStore } from '../store/discoveryStore';

beforeEach(() => {
    useDiscoveryStore.setState({
        captures: [],
        savedSessions: [],
        selectedUrl: null,
        lastFetchAt: Date.now(),
        lastError: null,
    });
    useMessagesStore.setState({
        messages: [],
        session: null,
        selectedSeq: null,
        filters: {
            directions: new Set(ALL_DIRECTIONS),
            kinds: new Set(ALL_KINDS),
            search: '',
            showStreams: true,
        },
    });
});

describe('CommandPalette', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it('lists base commands when open', () => {
        render(<CommandPalette open onClose={() => {}} />);
        expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
        expect(screen.getByText('Deselect message')).toBeInTheDocument();
        expect(screen.getByText('Reset all filters')).toBeInTheDocument();
    });

    it('fuzzy-filters commands by every token', () => {
        render(<CommandPalette open onClose={() => {}} />);
        fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
            target: { value: 'reset filters' },
        });
        expect(screen.getByText('Reset all filters')).toBeInTheDocument();
        expect(screen.queryByText('Deselect message')).not.toBeInTheDocument();
    });

    it('shows "no match" when nothing matches', () => {
        render(<CommandPalette open onClose={() => {}} />);
        fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
            target: { value: 'zzzzzzz' },
        });
        expect(screen.getByText('no match')).toBeInTheDocument();
    });

    it('runs a command on click and closes', () => {
        useMessagesStore.setState({ selectedSeq: 7 });
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} />);
        fireEvent.click(screen.getByText('Deselect message'));
        expect(useMessagesStore.getState().selectedSeq).toBeNull();
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('runs the active command on Enter', () => {
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} />);
        fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
            target: { value: 'reset all filters' },
        });
        fireEvent.keyDown(document, { key: 'Enter' });
        expect(onClose).toHaveBeenCalled();
    });
});
