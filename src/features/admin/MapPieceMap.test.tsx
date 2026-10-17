import { render,screen } from '@testing-library/react';
import { expect,it } from 'vitest';
import { MapPieceMap } from './MapPieceMap';
it('renders the north row above the south row and supports a non-editable location dot',()=>{
 const {container}=render(<MapPieceMap ariaLabel="board" highlightedPiece="A1" point={[100,1200]}/>);
 const north=screen.getByLabelText('A1'),south=screen.getByLabelText('H1');
 expect(Number(north.querySelector('text')?.getAttribute('y'))).toBeLessThan(Number(south.querySelector('text')?.getAttribute('y')));
 expect(north).not.toHaveAttribute('tabindex');
 expect(container.querySelector('circle')).toHaveAttribute('cy','120');
});
