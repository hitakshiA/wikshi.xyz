import parse from 'html-react-parser';
import markup from './wikshi-markup.json';

export function Footer() {
  return <>{parse(markup.Footer)}</>;
}
