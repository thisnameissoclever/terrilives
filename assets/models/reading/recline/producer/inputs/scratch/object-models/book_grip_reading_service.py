"""Public complete reading interface, retaining actual frames and witness scope."""
import numpy as np
from book_grip_reading_evaluator_v2 import ReadingPoseInput,CompleteReadingEvaluator,gate


class ReadingEvaluator(CompleteReadingEvaluator):
    def evaluate_snapshot(self,snapshot,arrays,prefix,deadline=None):
        result=super().evaluate_snapshot(snapshot,arrays,prefix,deadline)
        for row in result['rows']:
            if row['kind']=='rigid_face_and_pupil_contract':row['surfaces']=row.pop('parts')
        result.update(evaluated_frames={n:np.asarray(m).tolist() for n,m in snapshot['frames'].items()},
            rig_matrix_world=np.asarray(snapshot['rig_matrix_world']).tolist(),
            actual_surface_prefix=prefix+'/geometry',input_identity=self.context.identity,
            selected_binding=self.context.scope['binding'],scope=self.context.scope,
            acceptance='Complete static geometry gate only; visible intent, motion, seat fit and owner approval remain separate')
        return result


def eligible_for_preference(evaluation):
    """A preference score cannot turn a failed or unresolved state into a candidate."""
    return bool(evaluation['feasible']) and gate(evaluation['rows'],evaluation['coverage'])['feasible']
