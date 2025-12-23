import { Component } from '@angular/core';
import { PitchShifterComponent } from './components/pitch-shifter/pitch-shifter.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [PitchShifterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {
  title = 'pitch-shifter';
}
