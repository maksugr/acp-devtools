import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';
import { useThemeStore } from '../store/themeStore';

beforeEach(() => {
    useThemeStore.setState({ mode: 'system' });
});

describe('ThemeToggle', () => {
    it('renders a collapsed trigger reflecting the active mode', () => {
        render(<ThemeToggle />);
        const trigger = screen.getByRole('button');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveAttribute('title', expect.stringContaining('follow OS theme'));
    });

    it('opens a menu with all three modes', () => {
        render(<ThemeToggle />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(screen.getByRole('menuitemradio', { name: /auto/i })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        expect(screen.getByRole('menuitemradio', { name: /light/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitemradio', { name: /dark/i })).toBeInTheDocument();
    });

    it('selects a mode and closes the menu', () => {
        render(<ThemeToggle />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /light/i }));
        expect(useThemeStore.getState().mode).toBe('light');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
